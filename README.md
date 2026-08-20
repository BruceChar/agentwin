# AgentWin — 加密数字货币看板投资系统

基于 **Binance 真实行情** + **本地模拟账户（paper trading，绝不触碰真实资金）** 的加密货币看板投资系统。
LLM 分析采用 **pi-ai SDK**（`@earendil-works/pi-ai`），可对话询问策略、自动迭代交易系统、分析交易日志、点评舆情。

> 架构原则：真实市场数据驱动，模拟账户成交；核心引擎全部接口化，存储与行情源可插拔。

## 功能模块

| 模块 | 说明 |
| --- | --- |
| `packages/shared` | 领域模型与数值工具（订单/持仓/交易/盈亏/指标类型） |
| `packages/db` | 存储适配层：`StorageAdapter` 接口 + SQLite（Node 内置 `node:sqlite`，零依赖）；预留 DuckDB/Postgres 适配 |
| `packages/market` | Binance 行情适配：REST（kline/ticker/exchangeInfo）+ WebSocket（kline/aggTrade/bookTicker/markPrice），现货 + USDT-M 合约；含 Mock 数据源 |
| `packages/core` | 技术指标（SMA/EMA/RSI/MACD/ATR/BOLL）+ 绩效指标（Sharpe/回撤/胜率/盈亏比）+ 模拟投资组合 |
| `packages/strategy` | 策略接口 + 注册表 + 内置策略（MA 交叉/RSI/网格/布林） |
| `packages/engine` | 回测引擎 + Paper Trading 引擎（真实行情、模拟账户、断点续跑） |
| `packages/llm` | pi-ai 封装：策略顾问 / 系统迭代器 / 日志分析 / 舆情打分（默认 DeepSeek） |
| `packages/sentiment` | 舆情采集（RSS/新闻/自定义文本）+ LLM 打分聚合 |
| `apps/api` | Fastify REST API |
| `apps/web` | Vue 3 + Vite + Element Plus + ECharts 看板 |

## 快速开始

```bash
pnpm install
cp .env.example .env   # 填入 DEEPSEEK_API_KEY 等
pnpm typecheck
pnpm test
pnpm --filter @agentwin/engine paper   # 启动 paper trading（需要 Binance 网络可达）
pnpm dev:api
pnpm dev:web
```

## 存储适配层

`StorageAdapter` 定义统一的数据访问接口（账户/持仓/订单/交易/kline/策略/LLM 会话/舆情/回测/日志）。
默认实现 `SqliteStorage`（Node 24 内置 `node:sqlite`，无需任何原生编译）；后续可按需新增
DuckDB（分析型工作负载）与 Postgres（多进程/远程）实现，通过 `DB_ENGINE` 切换。

## Paper Trading 设计

- 订阅 Binance **真实行情**（REST kline 补历史 + WebSocket 实时），成交价格带滑点与手续费模拟；
- 账户/订单/交易/权益曲线全部落库，重启可恢复（断点续跑）；
- **绝不向 Binance 下发真实订单**；BINANCE_API_KEY 仅用于可选的只读账户对账。
