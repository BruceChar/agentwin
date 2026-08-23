# AgentWin — 加密数字货币看板投资系统

基于 **Binance 真实行情** + **本地模拟账户（paper trading，绝不触碰真实资金）** 的加密货币看板投资系统。
LLM 分析采用 **pi-ai SDK**（`@earendil-works/pi-ai`）：可对话询问策略、自动迭代交易系统、分析交易日志、点评舆情（默认 DeepSeek）。

> 架构原则：真实市场数据驱动，模拟账户成交；核心引擎全部接口化，存储与行情源可插拔。

## 功能总览

| 模块 | 说明 | 状态 |
| --- | --- | --- |
| `packages/shared` | 领域模型与数值工具 | ✅ |
| `packages/db` | 存储适配层 `StorageAdapter` + **SQLite**（Node 内置 `node:sqlite`，零依赖）+ **DuckDB**（列存分析型，`DB_ENGINE=duckdb` 切换） | ✅ |
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

**国内网络连通性**：`api.binance.com` 常被 DNS 污染（解析到错误 IP 导致超时）。行情层已内置多主机自动回退：
现货 REST 回退 `data-api.binance.vision`、现货 WS 回退 `data-stream.binance.vision`（官方公共行情端点，已实测可用）；
合约端点 `fapi.binance.com` 与 WS 端点均可用 `BINANCE_*_BASE_URL` 环境变量显式覆盖（如走代理/镜像）。
`GET /api/health` 返回 `binance: { ok, host }` 展示当前选中的可用主机。

**行情实现选择**（`.env` `BINANCE_PROVIDER`）：
- `native`（默认）：自研轻量客户端（REST 多主机回退 + WS 自动重连），零依赖、已实测国内网络可用；
- `official`：币安官方自动生成连接器（`@binance/spot` / `@binance/derivatives-trading-usds-futures`），REST 走官方 SDK 并支持 `basePath` 指向回退主机（`data-api.binance.vision`），WebSocket 复用内置客户端。两种实现都实现同一 `MarketDataProvider` 接口，业务层无感知。

```bash
pnpm dev:api   # http://127.0.0.1:3000 （默认 .env，真实 Binance 行情）
pnpm dev:web   # http://127.0.0.1:5173 （Vite，/api 代理到后端）
```

## LLM 能力（pi-ai SDK）

- **策略顾问**（`POST /api/llm/chat` 一次性返回 / `POST /api/llm/chat-stream` SSE 流式打字机）：对话式 agent，自动调用 `get_klines / run_backtest / get_account / get_pnl / get_sentiment / create_strategy` 等工具，基于真实数据给建议；策略草稿需人工确认后启用。
- **系统迭代器**（`POST /api/llm/iterate`）：输入当前策略回测绩效 + 交易日志，输出下一版策略提案（JSON）。
- **日志分析**（`POST /api/llm/analyze-journal`）：交易流水 + 复盘 → 纪律评分与改进建议。
- **舆情打分**（`POST /api/sentiment/score`）：单条新闻 → 情绪分。

更换提供商：`.env` 里 `LLM_PROVIDER`（openai/anthropic/google/moonshot…）+ 对应 `*_API_KEY`，模型名见 `LLM_MODEL`。

## 存储适配层

`StorageAdapter` 定义统一接口（账户/余额/K线/订单/成交/持仓/策略/权益/LLM 会话/舆情/回测/日志）。
已有两个可用实现：
- `SqliteStorage`（默认）：Node 24 内置 `node:sqlite`，零依赖零编译，事务/upsert 完整；
- `DuckdbStorage`：`DB_ENGINE=duckdb` 切换，列存向量化，适合大量 K 线与回测数据（schema 用 BIGINT/DOUBLE 保证跨引擎一致）；
- Postgres 适配（多进程/远程）按同一接口补充即可，业务层无感知。

## 真实账户（只读对账）

在 `.env` 配置 `BINANCE_API_KEY` / `BINANCE_API_SECRET` 后，系统会：
- 启动时自动创建「真实」账户（`binance-real`）并**自动同步一次**，覆盖 **5 个市场**：现货（SPOT）、全仓杠杆（MARGIN）、逐仓杠杆（MARGIN_ISOLATED，按交易对展示持仓）、U本位合约（USDT_M）、币本位合约（COIN_M）——余额/持仓/成交分别落库，幂等去重（每币种 200 条）；
- 提供 `POST /api/binance/sync`（手动全量同步）、`GET /api/binance/account`（实时快照）、`GET /api/binance/trades?symbol=`（实时成交）、`GET /api/binance/orders`（当前挂单）、`GET /api/binance/status`（Key 配置与官方接口连通性）；
- 看板「总览」可切换真实/模拟账户并点击「从币安同步」，「交易与盈亏」页可切换账户查看。

> 注意：私有接口（签名请求）只对官方主端点 `api.binance.com` / `fapi.binance.com` 有效——如果这两个域名在你的网络不可达（DNS 污染），同步会失败并在看板给出提示，此时请配置代理或 `BINANCE_*_BASE_URL` 指向可用的主端点镜像。全程只读，不会通过同步模块下单。

**真实账户同步排查**（看板显示「未配置 Key」或「同步失败」时按序检查）：
1. **Key 是否被读取**：`GET /api/binance/status` 的 `configured`。为 `false` 说明服务端没读到 `.env`——请确认 Key 在**仓库根目录**的 `.env`（不是 `.env.example`），并重启 `pnpm dev:api`（现已自动加载仓库根 .env）。
2. **主域名是否可达**：`reachable` 为 `false` 说明 `api.binance.com` 被 DNS 污染（运营商返回假 IP，如 Facebook 的地址）。处理：a) 看板代理开关切换直连/代理；b) 按 [docs/hosts-binance.txt](docs/hosts-binance.txt) 把真实 IP 写入系统 hosts（绕过污染 DNS）；c) 更换系统 DNS（223.5.5.5 / 1.1.1.1）；d) 签名请求会自动回退官方备用域名 `api1-4.binance.com`。
3. **同步失败原因**：`status.lastSync.message`（看板有红色提示条）会给出具体错误（网络、Key 无权限等）。

**受限地区（Geo-block）专项排查**：若报错含 `Service unavailable from a restricted location`，说明**出口 IP 在受限地区（通常是美国）**。处理：
1. `GET /api/binance/diagnose` 可直接查看「代理出口国家」（`proxyExit.country`）与 DNS 污染情况——把代理节点切换到非受限地区（新加坡/日本/香港等）即可；
2. 若本机直连币安全部超时（DNS 污染 + 出口被墙），hosts 方案通常无效，**必须走代理**，且代理出口不能是受限地区；
3. 走代理时 REST 使用 undici 自带 fetch（与 Node 内置 fetch 兼容性修复），WebSocket 使用 `ws` + `https-proxy-agent`（CONNECT 隧道），两者都已在本地代理上实测连通（457 拦截前能到达币安）。

**代理设置**（报 `Service unavailable from a restricted location` 时，通常是代理出口 IP 在受限地区，如美区）：
- `BINANCE_PROXY=off` 强制直连；`BINANCE_PROXY=on` 走代理（`BINANCE_PROXY_URL` 或 `HTTPS_PROXY`）；`BINANCE_PROXY=auto`（默认）有 `HTTPS_PROXY` 则走、否则直连。
- REST 与 WebSocket 都支持（undici `ProxyAgent`，含 CONNECT 隧道）；`GET /api/binance/status` 与 `/api/health` 会返回当前代理配置（`proxy: { mode, url, enabled, source }`）便于诊断。
- **运行时开关**：`GET/POST /api/binance/proxy`（`POST` body：`{ mode: 'off'|'on'|'auto', url? }`）可在不重启的情况下切换，看板「总览」页也有代理开关（直连/走代理 + 地址输入，即时生效）。

## 结构化交易日志（核心：迭代交易系统）

每笔交易按 **A-G 七段模板** 记录（基本信息 / 交易前计划 / 实际执行 / 市场条件 / 情绪与决策 / 结果分析 / 复盘总结与迭代），用于持续迭代自己的交易系统。

- **存储**：JSONL 为主（`data/trade-journal.jsonl`，每行一条，便于备份/迁移），SQLite 为辅助镜像（快速查询/统计；JSONL 丢失可自动从镜像恢复）；
- **自动提取**（`POST /api/journal/trades/autofill`）：填写 开/平仓价+数量+方向+风险金额 后，自动计算 盈亏/费用/净收益/R倍数/盈亏%/持仓时长，并从**真实行情**提取 开仓点 RSI/ATR/EMA 指标、波动率、持仓期间 MFE/MAE；
- **统计**（`GET /api/journal/trades/stats`）：胜率、盈亏比、平均 R、期望值、净盈亏、规则符合度、标签频率、按策略版本/市场分组、"计划 vs 实际"偏差统计；
- **看板**（交易日志页）：**分阶段填写**（交易计划 → 实际执行 → 复盘总结 三步时间线导航；交易计划按模板：目标/品种/方向/杠杠/仓位/账户资金/开仓价/分批止损（价格或%+仓位比）/止盈/预估胜率/目标盈亏比/策略名称+版本/失效条件）＋ 预设标签/芯片/滑块（情绪、心理、指标、归因等）＋ 前端实时计算（风险回报比、止损距离%、滑点、持仓时长、盈亏/R 预览）＋ 一键「自动计算」＋ 阶段完成度标记（列表/详情）＋ 记录列表（点击行编辑）；
- 结合 `/api/llm/iterate` 与 `/api/llm/analyze-journal`，可让 LLM 基于日志给出系统迭代建议。

## Paper Trading 设计

- 订阅 Binance **真实行情**（REST 300 根预热 + WebSocket 实时），成交价含滑点与手续费模拟；
- 只处理**已收盘 K 线**（防未来函数）；kline/订单/成交/持仓/权益全部落库，重启自动回放错过的 K 线；
- **绝不向 Binance 下发真实订单**；支持现货与 U本位合约（含做空与反向开仓）；
- 合约支持 **资金费结算**：订阅标记价格流，按 Binance 约定（正费率多头付空头）在每期 funding time 自动结算现金。

## API 速览（前缀 /api）

`health` · `market/klines|tickers|symbols` · `accounts` · `strategies(+builtin)` · `backtest(s)` ·
`paper/start|stop|status` · `trades` · `pnl` · `binance/status|sync|account|trades|orders|proxy` ·
`llm/chat|chat-stream(SSE)|iterate|analyze-journal|sessions` · `sentiment/scan|score|:symbol` · `journal`

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
