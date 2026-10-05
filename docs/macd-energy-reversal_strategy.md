# MACD 量价势能衰竭反转策略・设计文档

**状态**：设计已确认，待实现
**策略 ID**：`macd_energy_reversal`（主 ID）
**兼容别名**：`macd_energy`（若已有引用、回测记录或注册表锁定，保留为别名）
**策略名称**：MACD 量价势能衰竭反转
**英文名**：MACD Momentum Exhaustion Reversal
**副标题**：相邻同向 MACD 波形势能衰减 + 成交量不缩确认
**类型**：动量衰竭反转（Momentum Exhaustion Reversal），量价动能背离确认
**更新**：2026-10-05

## 0. 命名与术语说明

- “势能”在本文中指 MACD 柱（hist）在相邻同向波形中的相对强度；更标准的动量术语为“动能”。
- “变态势能识别”适合作为信号层描述，不作为最终策略名。
- 最终策略名采用：**MACD 量价势能衰竭反转**。
- 策略 ID 推荐使用 `macd_energy_reversal`；若项目注册表已锁定，可保留 `macd_energy` 为主 ID，将 `macd_energy_reversal` 作为推荐别名。
- 本文后续默认主 ID 为 `macd_energy_reversal`，兼容别名 `macd_energy`。

---

## 1. 背景与信号来源

用户原始观察来自两轮口述与图表确认：

### 第一轮：MACD 极值锚定

- 前一个 MACD 高点势能为 150，经过一个完整波形后，新的 MACD 高点只有 20，但成交量与前期相当甚至更大 → 看跌变态势能信号。
- 前一个 MACD 低点势能为 -200，经过一个波形后新低点只有 -50，负谷变浅，成交量相当或更大 → 看涨信号。

### 第二轮：量峰锚定，图例确认

图中最高的绿色成交量柱所对应的 MACD 柱，势能明显比之前一波弱，虽然成交量创了新高。
量能放大创新高、MACD 动能却不创新高 → 看跌信号，行情随后确实下跌。

### 统一框架

两轮描述统一为同一框架：

> 相邻同向波形之间，MACD 势能衰减 + 成交量不缩的“量价动能背离”信号。

差异只在锚定对象：

- `anchor=volume`：量峰锚定，默认，贴合图例。
- `anchor=hist`：MACD 极值锚定，贴合第一轮描述。

### 与经典 MACD 背离的区别

| 维度     | 经典价格-MACD 顶背离    | 本策略                                           |
| -------- | ----------------------- | ------------------------------------------------ |
| 比较对象 | 价格新高 vs MACD 不新高 | MACD 自身相邻同向区段极值 / 量峰处势能           |
| 锚定对象 | 价格极值                | `anchor=volume` 量峰 / `anchor=hist` 极值    |
| 关键确认 | 无，仅形态              | 成交量不缩甚至放大，硬性确认                     |
| 信号含义 | 趋势可能反转            | 动能衰竭 + 资金仍在进场 / 承接 → 变盘可信度更高 |
| 适用场景 | 趋势末端                | 震荡市、拐点、放量滞涨、放量抗跌                 |

---

## 2. 策略概要

| 项       | 内容                                                               |
| -------- | ------------------------------------------------------------------ |
| 信号本质 | MACD 柱 hist 同向波形序列的“相对势能”衰减检测 + 成交量确认       |
| 锚定方式 | `anchor=volume` 量峰锚定，默认；`anchor=hist` 极值锚定         |
| 相对势能 | 新 / 旧比值，与价格量级无关，可直接设置“偏离程度”                |
| 入场     | 信号在区段结束后的异号 bar 确认，下一根 bar 执行                   |
| 方向     | 看跌开空或平多反手；看涨开多或平空反手                             |
| 出场     | 默认反向信号反手管理；可启用固定止盈 / 止损                        |
| 目标市场 | SPOT / USDT_M，U 本位合约                                          |
| 建议周期 | ≥ 15m，小周期量能噪音大；默认 1h / 4h                             |
| 命名定位 | 信号层可称“MACD 变态势能识别”；策略层为“MACD 量价势能衰竭反转” |

---

## 3. 核心概念定义

### 3.1 MACD 柱 hist

`hist = macdLine − signalLine`，由 `@agentwin/core` 的 `macd(closes, fast, slow, signal)` 计算。

### 3.2 波形 / 区段 zone

hist 连续同号的一段 K 线区间：

- 正区段 `S⁺`：hist > 0。
- 负区段 `S⁻`：hist < 0。
- 一次完整波形周期：一个区段从形成到结束，即 hist 符号翻转。
- 区段结束判定：当前 bar 与上一根 bar 的 hist 异号，则上一区段结束于上一根 bar。

### 3.3 区段势能

- 正区段峰值：`P = max(hist)`。
- 负区段谷值：`N = min(hist)`。
- 负区段比较时统一取绝对值。

### 3.4 量峰与量峰处势能

- 量峰 bar：区段内成交量最大的 bar。
- 并列处理：若多个 bar 成交量并列最大，取更靠近区段结束的 bar，保证确定性。
- 量峰处 hist：`Hv = 量峰 bar 的 hist`。
- 区段量能 `V`：
  - `volWindow=0` 时，取量峰 bar 单根成交量。
  - `volWindow>0` 时，取量峰 bar 邻域 ±`volWindow` 根的成交量均值。
  - 邻域超出区段时，按区段内可用 bar 截断，避免跨异向区段污染。

### 3.5 相对势能

新区段势能 B 与前一同向区段势能 A 的比值。统一用：

> `新 ≤ 旧 × decayRatio`

判定“明显变弱”。负区段用绝对值比较，即负谷变浅。

### 3.6 同向区段配对

按时间顺序，当前刚结束区段 `z` 与最近一个已结束同向区段 `zPrev` 配对。
`zPrev.end < z.start`，中间可隔一个异向区段。

### 3.7 去重标记

`lastSignalZone` 记录最近一次实际触发交易意图的区段 `end index`。
只有真正生成交易动作时才记录；被过滤掉的区段不记录，避免误去重。

---

## 4. 信号数学定义

### 4.1 锚定 volume，默认，贴合图例

对相邻两个同向区段：前区段 A → 新区段 B。

#### 看跌信号：正区段对

量峰创新高但动能没跟上：

```
Hv_B ≤ P_A × decayRatio
且 V_B ≥ V_A × volConfirmRatio
且 |Hv_B| ≥ minAbsEnergy          若启用
```

若 `strictPeakDecay=true`，额外要求：

```
P_B ≤ P_A × decayRatio
```

含义：量能创新高，绿色柱最高，但量峰处 MACD 动能不创新高 → 多头动能衰竭，资金仍在进场 → 看跌变盘。

#### 看涨信号：负区段对

负谷变浅但量能承接：

```
|Hv_B| ≤ |N_A| × decayRatio
且 V_B ≥ V_A × volConfirmRatio
且 |Hv_B| ≥ minAbsEnergy          若启用
```

若 `strictPeakDecay=true`，额外要求：

```
|N_B| ≤ |N_A| × decayRatio
```

含义：量能放大或持平，但空头势能明显变浅 → 空头动能衰竭，资金仍在承接 → 看涨变盘。

### 4.2 锚定 hist，贴合第一轮描述

#### 看跌信号：正区段对

```
P_B ≤ P_A × decayRatio
且 V_B ≥ V_A × volConfirmRatio
且 P_B ≥ minAbsEnergy              若启用
```

#### 看涨信号：负区段对

```
|N_B| ≤ |N_A| × decayRatio
且 V_B ≥ V_A × volConfirmRatio
且 |N_B| ≥ minAbsEnergy            若启用
```

### 4.3 为什么用比值

MACD 柱量级随币价与周期变化。
BTC 的 150 与山寨币的 150 意义不同。
比值 `新 / 旧 ≤ decayRatio` 与价格量级无关，直接刻画“势能衰减到前峰的几成”，即用户所说的“偏离程度”。

### 4.4 信号确认与执行

- 信号在区段结束后的第一根异号 bar 确认。
- 下一根 bar 执行，避免追在极值 / 量峰尖上。
- 同一区段只触发一次。

---

## 5. 参数规范 paramSpecs

| 参数名              |    类型 |       默认 |                            范围 | 步长 | 含义                                                                                      |
| ------------------- | ------: | ---------: | ------------------------------: | ---: | ----------------------------------------------------------------------------------------- |
| `fast`            |  number |         12 |                           2–50 |    1 | MACD 快 EMA 周期                                                                          |
| `slow`            |  number |         26 |                          5–100 |    1 | MACD 慢 EMA 周期                                                                          |
| `signal`          |  number |          9 |                           2–50 |    1 | MACD 信号周期                                                                             |
| `anchor`          |  string | `volume` |           `volume` / `hist` |   — | 锚定方式：量峰 / MACD 极值                                                                |
| `decayRatio`      |  number |        0.5 |                        0.1–0.9 | 0.05 | 新势能 ≤ 前势能 × 该比例；0.3 更严，0.7 更宽松                                          |
| `volConfirmRatio` |  number |        0.9 |                        0.1–1.5 | 0.05 | 新量 ≥ 前量 × 该比例；0.9 允许略缩，1.1 要求真放量                                      |
| `volWindow`       |  number |          3 |                           0–10 |    1 | 量峰邻域 ±N 根平均量；0 = 单根量                                                         |
| `minAbsEnergy`    |  number |          0 |                             ≥0 | 0.01 | 最小势能绝对值过滤，0 = 关闭；需按币种价格量级设置                                        |
| `strictPeakDecay` | boolean |      false |                    true / false |   — | 仅`anchor=volume` 时生效；额外要求新区段 hist 峰值 / 谷值也衰减                         |
| `sideMode`        |  string |   `both` | `both` / `long` / `short` |   — | 双向 / 仅多 / 仅空                                                                        |
| `trendFilter`     |  string |    `off` |    `off` / `ema` / `zero` |   — | `ema`：价格在 EMA 上方才看涨、下方才看跌；`zero`：MACD 线在零轴上才看涨、零轴下才看跌 |
| `trendEmaPeriod`  |  number |         50 |                          5–200 |    1 | 仅`trendFilter=ema` 时生效                                                              |
| `sizePct`         |  number |        0.9 |                         0.05–1 | 0.05 | 开仓比例，按可用权益                                                                      |
| `takeProfitPct`   |  number |       0.05 |                            0–1 | 0.01 | 浮盈达该比例平仓，0 = 关闭                                                                |
| `stopLossPct`     |  number |       0.03 |                            0–1 | 0.01 | 浮亏达该比例平仓，0 = 关闭                                                                |

### 参数校验与警告

- 建议 `fast < slow`，否则给出警告。
- `minAbsEnergy` 过大时可能导致信号永远无法触发，因为需同时满足 `|新势能| ≥ minAbsEnergy` 且 `|新势能| ≤ |旧势能| × decayRatio`。应低于典型旧势能 × `decayRatio`。
- `sideMode` 与反手逻辑必须一致：
  - `both`：允许反手。
  - `long`：只开多、只持多；看跌信号仅平多，不反手开空。
  - `short`：只开空、只持空；看涨信号仅平空，不反手开多。
- `trendEmaPeriod` 仅在 `trendFilter=ema` 时生效。

---

## 6. 算法流程，贴合项目 onBar 接口

输入：`ctx.bars` 已收盘 K 线，含当前 bar、`bar`、`index`、`ctx.indicators` 策略缓存。

```text
onBar:
  1. hist = ctx.indicators['hist'] ??= macd(closes, fast, slow, signal).hist
     首次计算后缓存复用。

  2. 扫描 hist，切分区段序列：
     zones[] = { sign, start, end, P|N, V, Hv }
     区段结束点：当前 bar 与上一根 hist 异号
     → 上一区段 [start..i-1] 结束。

  3. 若当前 bar 刚确认一个区段 z 结束：
     取前一同向区段 zPrev，要求 zPrev.end < z.start。

  4. 按 anchor 选择比较量：
     - anchor=volume：
       Hv_z vs P_zPrev，或 |Hv_z| vs |N_zPrev|
       同时计算 V_z 与 V_zPrev。
     - anchor=hist：
       P_z vs P_zPrev，或 |N_z| vs |N_zPrev|
       同时计算 V_z 与 V_zPrev。

  5. 检查：
     - 衰减条件；
     - 量能确认；
     - minAbsEnergy，若启用；
     - strictPeakDecay，若启用；
     - trendFilter；
     - sideMode。

  6. 命中且 z.end 未被 lastSignalZone 记录过：
     生成信号。

  7. 生成 TradeIntent：
     - 看跌：
       both 且持多 → CLOSE 反手 OPEN_SHORT；
       both 且空仓 → OPEN_SHORT；
       long-only 且持多 → CLOSE；
       long-only 且空仓 → 无动作；
       short-only 且空仓 → OPEN_SHORT；
       short-only 且持多 → 不允许，理论上不应出现。
     - 看涨：
       both 且持空 → CLOSE 反手 OPEN_LONG；
       both 且空仓 → OPEN_LONG；
       short-only 且持空 → CLOSE；
       short-only 且空仓 → 无动作；
       long-only 且空仓 → OPEN_LONG；
       long-only 且持空 → 不允许，理论上不应出现。

  8. 只有实际生成交易动作时，才记录 lastSignalZone = z.end。

  9. reason 包含：
     anchor、衰减比、量比、zPrev 区间、z 区间
     便于复盘。
```

### 实现要点

- 区段扫描每次 `onBar` 全量重扫，首版保证确定性；后续可做增量缓存。
- `ctx.indicators` 缓存 hist 序列、区段结果、`lastSignalZone`。
- 信号在区段结束后的异号 bar 确认，下一根执行，避免追在极值 / 量峰尖上。
- 反手优先返回组合意图；若项目 TradeIntent 不支持同 bar `CLOSE + OPEN`，则拆分为同 bar 顺序执行，或下一根先平、再下一根开。
- 固定止盈止损若与信号同 bar 触发，建议风险优先：先检查 TP/SL，再评估新信号。

---

## 7. 进出场与风险管理

| 项                 | 规则                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| 入场               | 信号确认后下一根 bar；`sizeMode=pct`，`size=sizePct`                               |
| 反手               | `both` 模式下，持多遇看跌：先 CLOSE 再 OPEN_SHORT；持空遇看涨：先 CLOSE 再 OPEN_LONG |
| `sideMode=long`  | 只开多、只持多；看跌信号仅平多，不反手开空                                             |
| `sideMode=short` | 只开空、只持空；看涨信号仅平空，不反手开多                                             |
| 出场默认           | 反向信号反手平仓；无反向信号则持有                                                     |
| 出场可选           | `takeProfitPct` / `stopLossPct` 触发固定止盈止损                                   |
| 去重               | 同一区段只触发一次，`lastSignalZone` 仅记录实际发单区段                              |
| 过滤               | `trendFilter` 可选，防止单边强趋势中频繁反手                                         |
| 风险优先           | 同 bar 触发 TP/SL 与新信号时，建议先执行 TP/SL，再评估新信号                           |

---

## 8. 回测验证方案

注册后回测页可直接选择 `macd_energy_reversal`，兼容别名 `macd_energy`。

### 基准对比

- `macd_trend`：趋势型基准。
- `rsi`：反转型基准。

### 建议跑组

行情连通后：

- 品种 / 周期：BTCUSDT 1h / 4h / 1d；ETHUSDT 1h。
- 时间窗：90 天 / 180 天。
- 参数敏感性：
  - `decayRatio ∈ {0.4, 0.5, 0.6}`
  - `volConfirmRatio ∈ {0.8, 0.9, 1.0}`
  - `anchor ∈ {volume, hist}`
  - `strictPeakDecay ∈ {false, true}`

### 观察指标

- 胜率
- 盈亏比
- 最大回撤
- 交易次数
- 平均持仓时长
- 信号触发频率

反转策略重点看盈亏比与回撤，不追求高胜率。

### 行情不可达期间

用 mock 数据先验证信号触发逻辑的正确性与幂等性，单元测试覆盖：

- 看跌信号
- 看涨信号
- 反手
- `sideMode` 过滤
- 去重
- `strictPeakDecay`
- `volWindow`
- 量峰并列
- 参数边界

---

## 9. 适用场景与已知局限

### 适用

- 震荡市。
- 拐点识别。
- 放量滞涨与放量抗跌的变盘捕捉。
- 多周期共振时信号更强。

### 已知局限

- 极值 / 量峰确认滞后 1 根 bar，可接受，换取不追高。
- 小周期 <15m 量能噪音大，建议 1h+。
- 单边强趋势中反向信号频繁，建议开启 `trendFilter` 或仅在震荡行情启用。
- `decayRatio` 过严 <0.3 信号稀少，过松 >0.7 噪音增多，0.4–0.6 为推荐区间。
- `minAbsEnergy` 需按币种价格量级设置，默认关闭；设置过大可能导致无信号。
- `anchor=volume` 默认只检查量峰处 hist，不检查新区段 hist 峰值；若需更严格，启用 `strictPeakDecay`。
- 量峰并列时已定义取更靠近区段结束的 bar，保证确定性。

---

## 10. 实现与交付计划

| 步骤 | 内容                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 新建`packages/strategy/src/builtin/macdEnergyReversal.ts`，实现 `createMacdEnergyReversalStrategy()`，含 `describe`；可导出兼容别名 `createMacdEnergyStrategy()`                       |
| 2    | 注册进`packages/strategy/src/builtin/index.ts`，主 ID `macd_energy_reversal`，兼容别名 `macd_energy`                                                                                     |
| 3    | 单元测试`packages/strategy/test/macdEnergyReversal.test.ts`：构造衰减 + 放量 K 线序列，验证看跌 / 看涨信号、反手、`sideMode`、去重、`strictPeakDecay`、`volWindow`、量峰并列、参数边界 |
| 4    | `pnpm typecheck` + `pnpm test` 全绿                                                                                                                                                        |
| 5    | 行情连通后跑真实回测并对比基准策略                                                                                                                                                             |

**前置依赖**：Binance 行情连通。当前网络不可达时，真实回测无法执行，见 README 排查章节 / `docs/hosts-binance.txt`。

---

## 11. 一句话定位

> **MACD 量价势能衰竭反转**：在相邻同向 MACD 波形之间，检测势能衰减，并要求成交量不缩，捕捉放量滞涨与放量抗跌后的变盘反转。
