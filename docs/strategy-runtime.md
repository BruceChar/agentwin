# 策略实时运行时（Strategy Runtime）

**目标**：策略启动后作为**独立后台任务**持续运行、实时更新；更新粒度可按周期配置；
每次更新产生**指标事件**，通知下游消费（WebSocket / 轮询），或用于实时更新 K 线图。

## 1. 与回测 / paper trading 的区别

| 形态 | 触发 | 职责 | 输出 |
| ---- | ---- | ---- | ---- |
| 回测 `runBacktest` | 历史 K 线一次性推进 | 模拟撮合 + 绩效 | BacktestResult |
| paper `PaperTradingEngine` | 订阅实时 K 线（收盘 bar） | 模拟下单 + 持仓 + 权益 | 订单 / 成交 / 权益 |
| **运行时 `StrategyRuntime`** | 订阅实时 K 线（按粒度） | **只算指标、不下单** | **K 线 / 指标 / 信号事件** |

运行时负责"在后台持续更新指标并发出事件"，是否据此下单由下游决定。

## 2. 更新粒度 granularity

运行时是独立的后台异步任务，与 HTTP 请求周期解耦。`granularity` 决定重算节奏：

| granularity | 语义 | 更新（事件）时机 | 事件频率 |
| ----------- | ---- | ---------------- | -------- |
| `bar`（默认） | 频率 = 配置周期 | 仅当该周期 K 线**收盘**时更新 | 如 1h → 每小时 1 次 |
| `intra` | 盘中节流 | 收盘必更新；盘中每 `throttleMs` 更新一次 | `throttleMs` 一次 |

- `throttleMs` 缺省按周期推导：`clamp(周期/20, 1s, 30s)`（如 1m→3s，15m/1h→30s）。
- **只有到更新点才产生事件**：未到点时（例如未收盘 K 线的秒级推送）不发出任何事件，
  因此默认 `bar` 粒度下事件频率就是 K 线周期，不会秒级刷屏。
- `candle` 与 `indicator` 在同一更新点成对发出（`candle` 供图表刷新，`indicator` 供指标/信号消费）。

> 关于"单独的线程"：Node 单线程事件循环下，指标计算量很小（几百根 K 线），
> 运行时以**独立后台任务**运行即可；若某策略将来成为 CPU 瓶颈，可将 `StrategyRuntime`
> 放入 `worker_threads`，其对下游的事件接口保持不变。

## 3. 事件

所有事件公共字段：`runtimeId, seq, at, symbol, market, interval, strategyId`。

| type | 载荷 | 用途 |
| ---- | ---- | ---- |
| `start` / `stop` | — | 生命周期 |
| `candle` | `candle, closed` | 更新最新一根 K 线（`closed=false` 为未收盘 bar；仅 `intra` 会出现） |
| `indicator` | `candle, closed, indicators, signal` | 指标快照 + 策略信号 |
| `error` | `message` | 策略计算异常（不中断运行时） |

`indicators`：`{ fast, slow, signal, emaFast, emaSlow, dif, dea, hist, rsi }`（标准 EMA/MACD/RSI 快照）。
`signal`：`{ action, sizeMode, size, reason } | null`（策略本次给出的意图，运行时自身不下单）。

## 4. HTTP API

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | `/api/strategy-runtime/start` | 启动运行时（后台） |
| POST | `/api/strategy-runtime/stop` | 停止（body `{ id }`） |
| GET  | `/api/strategy-runtime` | 列出运行中的运行时 |
| GET  | `/api/strategy-runtime/events` | 事件环形缓冲（`runtimeId`、`since`、`limit`），用于轮询/断线重放 |

`POST /api/strategy-runtime/start` body：

```json
{
  "strategyId": "macd_energy_reversal",
  "symbol": "BTCUSDT",
  "market": "USDT_M",
  "interval": "15m",
  "granularity": "intra",
  "throttleMs": 5000,
  "warmupLimit": 300,
  "params": { "priceRatio": 0.9, "volRatio": 0.8, "macdRatio": 0.2 },
  "id": "可选：自定义运行时 id"
}
```

响应为 `RuntimeStatus`：`{ id, running, strategyId, symbol, market, interval, granularity, throttleMs, bars, lastBarOpenTime, lastPrice, lastEventAt, startedAt, seq }`。

## 5. WebSocket 推送（下游消费）

`ws://<host>/api/ws/strategy`

- 客户端 → 服务端：`{ "type": "subscribe", "runtimeId": "<id>" }`（不带 `runtimeId` 订阅全部）、`{ "type": "unsubscribe", "runtimeId": "<id>" }`、`{ "type": "ping" }`。
- 服务端 → 客户端：`{ "type": "ready", "runtimes": ["<id>", ...] }`、`{ "type": "strategy-event", "event": { ... } }`、`{ "type": "pong", "at": 0 }`。

前端共享客户端见 `apps/web/src/lib/strategy-stream.ts`（`subscribeRuntime` / `subscribeAll`），
与顶栏价格用的 `lib/prices.ts` 同一套"单连接 + 多订阅者 + 自动重连"模式。

## 6. 与 K 线图集成

- 运行时事件中的 `candle` 可直接用于实时更新图表最新一根 K 线；
- `indicators`（MACD/EMA/RSI）可用于增量刷新指标面板；
- `signal` 可用于在图上标注实时信号（区别于回测标注）。
