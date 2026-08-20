# AgentWin — 加密数字货币看板投资系统

基于 **Binance 真实行情** + **本地模拟账户（paper trading，绝不触碰真实资金）** 的加密货币看板投资系统。
LLM 分析采用 **pi-ai SDK**（`@earendil-works/pi-ai`）：可对话询问策略、自动迭代交易系统、分析交易日志、点评舆情（默认 DeepSeek）。

> 架构原则：真实市场数据驱动，模拟账户成交；核心引擎全部接口化，存储与行情源可插拔。

## 功能总览

| 模块 | 说明 | 状态 |
| --- | --- | --- |
| `packages/shared` | 领域模型与数值工具 | ✅ |
| `packages/db` | 存储适配层 `StorageAdapter` + SQLite（Node 内置 `node:sqlite`，零依赖） | ✅ |
| `packages/market` | Binance REST/WS（现货 + U本位合约）+ `MarketDataProvider` + Mock 数据源 | ✅ |
| `packages/core` | 指标（SMA/EMA/RSI/MACD/ATR/BOLL）+ 绩效（Sharpe/回撤/胜率/盈亏比）+ 模拟组合（现货/合约双向） | ✅ |
| `packages/strategy` | 策略接口 + 注册表 + 内置（MA交叉/RSI反转/布林均值回归/网格/DCA/MACD趋势） | ✅ |
| `packages/engine` | 回测引擎 + Paper Trading 引擎（真实行情、模拟账户、断点续跑、手续费/滑点模拟） | ✅ |
| `packages/llm` | pi-ai 封装 + `TradingToolkit`（LLM 可调用 10 个交易工具）+ 策略顾问 / 系统迭代 / 日志分析 / 舆情打分 | ✅ |
| `packages/sentiment` | RSS 舆情采集（CoinTelegraph/CoinDesk/Decrypt）+ LLM 打分，无 Key 降级启发式 | ✅ |
| `apps/api` | Fastify REST API（行情/账户/策略/回测/paper/交易/盈亏/LLM/舆情/日志） | ✅ |
| `apps/web` | Vue 3 + Vite + Element Plus + ECharts 看板（8 个页面） | ✅ |

## 快速开始

```bash
pnpm install
cp .env.example .env   # 填入 DEEPSEEK_API_KEY（LLM 必需）；BINANCE key 可选（仅只读对账用）
pnpm typecheck         # 全仓类型检查
pnpm test              # 全仓测试（61 个用例）
```

**离线开发模式**（本机连不上 Binance 时）：`export AGENTWIN_USE_MOCK=1`，行情源切换为确定性 Mock 数据。

```bash
pnpm dev:api   # http://127.0.0.1:3000 （默认 .env，真实 Binance 行情）
pnpm dev:web   # http://127.0.0.1:5173 （Vite，/api 代理到后端）
```

## LLM 能力（pi-ai SDK）

- **策略顾问**（`POST /api/llm/chat`）：对话式 agent，自动调用 `get_klines / run_backtest / get_account / get_pnl / get_sentiment / create_strategy` 等工具，基于真实数据给建议；策略草稿需人工确认后启用。
- **系统迭代器**（`POST /api/llm/iterate`）：输入当前策略回测绩效 + 交易日志，输出下一版策略提案（JSON）。
- **日志分析**（`POST /api/llm/analyze-journal`）：交易流水 + 复盘 → 纪律评分与改进建议。
- **舆情打分**（`POST /api/sentiment/score`）：单条新闻 → 情绪分。

更换提供商：`.env` 里 `LLM_PROVIDER`（openai/anthropic/google/moonshot…）+ 对应 `*_API_KEY`，模型名见 `LLM_MODEL`。

## 存储适配层

`StorageAdapter` 定义统一接口（账户/余额/K线/订单/成交/持仓/策略/权益/LLM 会话/舆情/回测/日志）。
默认 `SqliteStorage`（Node 24 内置 `node:sqlite`，无需原生编译）；切换 `DB_ENGINE` 即可扩展
DuckDB（分析型）与 Postgres（多进程/远程）实现，业务层无感知。

## Paper Trading 设计

- 订阅 Binance **真实行情**（REST 300 根预热 + WebSocket 实时），成交价含滑点与手续费模拟；
- 只处理**已收盘 K 线**（防未来函数）；kline/订单/成交/持仓/权益全部落库，重启自动回放错过的 K 线；
- **绝不向 Binance 下发真实订单**；支持现货与 U本位合约（含做空与反向开仓）。

## API 速览（前缀 /api）

`health` · `market/klines|tickers|symbols` · `accounts` · `strategies(+builtin)` · `backtest(s)` ·
`paper/start|stop|status` · `trades` · `pnl` · `llm/chat|iterate|analyze-journal|sessions` ·
`sentiment/scan|score|:symbol` · `journal`

## 测试

```
packages/shared    5  tests  (数值/盈亏)
packages/core     12  tests  (指标/绩效/组合)
packages/market    6  tests  (Mock 行情/签名/解析)
packages/db        4  tests  (存储全流程)
packages/strategy  5  tests  (注册表/内置策略)
packages/engine    3  tests  (回测/paper 闭环)
packages/llm       9  tests  (工具/JSON/回测工具链)
packages/sentiment 4  tests  (RSS/打分/服务)
apps/api           7  tests  (REST 全链路含 paper)
```
