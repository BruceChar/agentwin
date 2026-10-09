
# MACD 量价势能衰竭反转策略・设计文档

**状态**：已实现（策略 + 校准模块 + 单元测试通过；真实回测待行情连通）
**策略 ID**：`macd_energy_reversal`
**兼容别名**：`macd_energy`
**策略名称**：MACD 量价势能衰竭反转
**英文名**：MACD Price-Volume Momentum Exhaustion Reversal
**副标题**：价格 → 成交量 → MACD 势能三重比率确认 + 0–10 信号强度评分 + 回测校准置信度
**类型**：动量衰竭反转（Momentum Exhaustion Reversal），量价动能背离确认
**更新**：2026-10-05

---

## 0. 命名与术语说明

- “势能”在本文中指 MACD 柱（hist）在相邻同向波形中的相对强度；更标准的动量术语为“动能”。
- 用户口径中的“变态 / 变势反转”，本文统一规范为“变盘 / 变势反转”。
- 策略名保留：**MACD 量价势能衰竭反转**。其中“量价”明确包含成交量与价格。
- 策略 ID 推荐使用 `macd_energy_reversal`；若项目注册表已锁定，可保留 `macd_energy` 为主 ID，将 `macd_energy_reversal` 作为推荐别名。
- 本版核心内容：
  1. 信号必须同时具备 **价格确认、成交量确认、MACD 势能确认**。
  2. 判定顺序固定为：**先看价格 → 再看成交量 → 最后确认 MACD 势能**，硬性短路。
  3. 价格、成交量、MACD 各自拥有独立可配置比率：
     - `priceRatio`：默认 `0.9`
     - `volRatio`：默认 `0.8`
     - `macdRatio`：默认 `0.2`
  4. 新增 **0–10 信号强度评分算法**，并支持多种评分模式与可配置 `scoreIMax`。
  5. 新增 **回测校准与置信度** 方法，将强度分映射为历史校准胜率与置信区间。

---

## 1. 背景与信号来源

用户原始观察来自两轮口述与图表确认，并在后续修正中加入价格维度、独立比率、强度评分与回测校准。

### 第一轮：MACD 极值锚定

- 前一个 MACD 高点势能为 150，经过一个完整波形后，新的 MACD 高点只有 20，但成交量与前期相当甚至更大 → 看跌变盘信号。
- 前一个 MACD 低点势能为 -200，经过一个波形后新低点只有 -50，负谷变浅，成交量相当或更大 → 看涨信号。

### 第二轮：量峰锚定，图例确认

图中最高的绿色成交量柱所对应的 MACD 柱，势能明显比之前一波弱，虽然成交量创了新高。
量能放大创新高、MACD 动能却不创新高 → 看跌信号，行情随后确实下跌。

### 第三轮：加入价格确认，固定判定顺序

完整信号统一为：

> 相邻同向波形之间，先比较价格，再比较成交量，最后比较 MACD 势能。
> 价格达到前极值的至少 `priceRatio` 倍、成交量达到前量的至少 `volRatio` 倍、MACD 势能衰减到前势能的至多 `macdRatio` 倍 → 变盘反转。

### 第四轮：引入 0–10 信号强度评分

刚好满足 `priceRatio=0.9`、`volRatio=0.8`、`macdRatio=0.2` 时，信号强度为 `1`。
如果价格达到前高的 `1.2` 倍，原始乘积约为 `1.33`，但该数值不直观。
需要将强度量化到 `0–10`，`1` 为合格线，`10` 为最强。

### 第五轮：Imax 可配置与回测校准

- 评分映射不应固定，`scoreIMax` 应作为可配置参数或模式。
- 1–10 分不是线性刻度，`2.44` 只是规则强度分，不是概率或置信度。
- 要得到概率/置信度，必须通过回测校准。
- 本版加入 `scoreMode`、`scoreIMax`，以及回测校准与置信度章节。

### 与经典 MACD 背离的区别

| 维度      | 经典价格-MACD 顶背离    | 本策略                                                                            |
| --------- | ----------------------- | --------------------------------------------------------------------------------- |
| 比较对象  | 价格新高 vs MACD 不新高 | 价格、成交量、MACD 势能三重比较                                                   |
| 判定顺序  | 无固定顺序              | 先价格 → 再成交量 → 后 MACD 势能                                                |
| 价格确认  | 价格新高                | 看跌：当前高点 ≥ 前高 ×`priceRatio`；看涨：当前低点 ≤ 前低 ÷ `priceRatio` |
| 量能确认  | 无，或非硬性            | 当前量 ≥ 前量 ×`volRatio`                                                     |
| MACD 确认 | MACD 不新高             | 当前势能绝对值 ≤ 前势能绝对值 ×`macdRatio`                                    |
| 信号强度  | 无                      | 0–10 评分，支持`saturating` / `linear` / `calibrated` 模式                 |
| 置信度    | 无                      | 通过历史回测校准为胜率与置信区间                                                  |
| 适用场景  | 趋势末端                | 震荡市、拐点、放量滞涨、放量抗跌、价格创新低/高但动能衰竭                         |

---

## 2. 策略概要

| 项            | 内容                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| 信号本质      | MACD 柱 hist 同向波形序列的“相对势能”衰减检测 + 价格确认 + 成交量确认    |
| 判定顺序      | 先价格，再成交量，最后 MACD 势能；硬性短路                                 |
| 锚定方式      | `anchor=volume` 量峰锚定，默认；`anchor=hist` 极值锚定                 |
| 价格确认      | 看跌：`PH_B ≥ PH_A × priceRatio`；看涨：`PL_B ≤ PL_A ÷ priceRatio` |
| 成交量确认    | `V_B ≥ V_A × volRatio`                                                 |
| MACD 势能确认 | 看跌：`Hv_B ≤ P_A × macdRatio`；看涨：`\|Hv_B\| ≤ \|N_A\| × macdRatio`（`anchor=hist` 时用区段极值 `P_B` / `\|N_B\|`） |
| 默认比率      | `priceRatio=0.9`，`volRatio=0.8`，`macdRatio=0.2`                    |
| 信号强度      | 0–10 评分，刚好满足三阈值为`1`，越强越接近 `10`                       |
| 评分模式      | `saturating` 默认 / `linear` / `calibrated`                          |
| 可配置 Imax   | `scoreIMax`，默认 `5.0`，仅 `linear` 模式生效                        |
| 入场          | 信号在区段结束后的异号 bar 确认，下一根 bar 执行                           |
| 方向          | 看跌开空或平多反手；看涨开多或平空反手                                     |
| 出场          | 默认反向信号反手管理；可启用固定止盈 / 止损                                |
| 目标市场      | SPOT / USDT_M，U 本位合约                                                  |
| 建议周期      | ≥ 15m，小周期量能噪音大；默认 1h / 4h                                     |

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

### 3.3 区段 MACD 势能

- 正区段峰值：`P = max(hist)`。
- 负区段谷值：`N = min(hist)`。
- 负区段比较时统一取绝对值。

### 3.4 区段价格极值

- 正区段价格高点：`PH = max(high)`。
- 负区段价格低点：`PL = min(low)`。
- 默认使用 `high` / `low` 捕捉区段极值。
- 若后续需要抗插针，可扩展 `priceSource=close`，但首版默认区段 high/low。

### 3.5 量峰与量峰处势能

- 量峰 bar：区段内成交量最大的 bar。
- 并列处理：若多个 bar 成交量并列最大，取更靠近区段结束的 bar，保证确定性。
- 量峰处 hist：`Hv = 量峰 bar 的 hist`。
- 区段量能 `V`：
  - `volWindow=0` 时，取量峰 bar 单根成交量。
  - `volWindow>0` 时，取量峰 bar 邻域 ±`volWindow` 根的成交量均值。
  - 邻域超出区段时，按区段内可用 bar 截断，避免跨异向区段污染。

### 3.6 三个独立比率

| 比率           | 默认 | 方向                                                                       | 含义                                         |
| -------------- | ---: | -------------------------------------------------------------------------- | -------------------------------------------- |
| `priceRatio` | 0.9 | 看跌：`PH_B ≥ PH_A × priceRatio`；看涨：`PL_B ≤ PL_A ÷ priceRatio` | 当前价格达到前极值的至少该比例，才算有效采样 |
| `volRatio`   |  0.8 | `V_B ≥ V_A × volRatio`                                                 | 当前量能达到前量的至少该比例，才算有效确认   |
| `macdRatio`  |  0.2 | 看跌：`Hv_B ≤ P_A × macdRatio`；看涨：`\|Hv_B\| ≤ \|N_A\| × macdRatio` | 新势能相对前势能至多该比例，越小衰减越明显   |

- 价格与成交量比率越大，代表当前价格/量能相对前值越强，信号可信度越高。
- MACD 比率越小，代表势能衰减越明显，信号越强。
- 三个比率均可独立回测调参。

### 3.7 同向区段配对

按时间顺序，当前刚结束区段 `z` 与最近一个已结束同向区段 `zPrev` 配对。
`zPrev.end < z.start`，中间可隔一个异向区段。

### 3.8 去重标记

`lastSignalZone` 记录最近一次实际触发交易意图的区段 `end index`。
只有真正生成交易动作时才记录；被过滤掉的区段不记录，避免误去重。

---

## 4. 信号判定顺序与数学定义

### 4.1 判定顺序总览

所有信号必须按以下顺序评估，前一步不满足则直接短路，不再检查后续步骤：

1. **第一步：价格确认**

   - 看跌：`PH_B ≥ PH_A × priceRatio`
   - 看涨：`PL_B ≤ PL_A ÷ priceRatio`
   - 不满足 → 跳过，不再检查成交量与 MACD。
2. **第二步：成交量确认**

   - 看跌与看涨统一：`V_B ≥ V_A × volRatio`
   - 不满足 → 跳过，不再检查 MACD。
3. **第三步：MACD 势能确认**

   - 看跌：`Hv_B ≤ P_A × macdRatio`，或 `P_B ≤ P_A × macdRatio`（`anchor=hist`）
   - 看涨：`|Hv_B| ≤ |N_A| × macdRatio`，或 `|N_B| ≤ |N_A| × macdRatio`（`anchor=hist`）
   - 不满足 → 不生成信号。
4. **第四步：附加过滤与执行**

   - `minAbsEnergy`
   - `strictPeakDecay`
   - `trendFilter`
   - `sideMode`
   - 去重
   - 计算信号强度评分
   - 生成 TradeIntent

### 4.2 锚定 volume，默认，贴合图例

对相邻两个同向区段：前区段 A → 新区段 B。

#### 看跌信号：正区段对

按顺序：

1. **价格确认**

   ```text
   PH_B ≥ PH_A × priceRatio
   ```
2. **成交量确认**

   ```text
   V_B ≥ V_A × volRatio
   ```
3. **MACD 势能确认**

   ```text
   Hv_B ≤ P_A × macdRatio
   且 |Hv_B| ≥ minAbsEnergy          若启用
   ```
4. **可选严格峰值衰减**

   ```text
   P_B ≤ P_A × macdRatio              若 strictPeakDecay=true
   ```

#### 看涨信号：负区段对

按顺序：

1. **价格确认**

   ```text
   PL_B ≤ PL_A ÷ priceRatio
   ```
2. **成交量确认**

   ```text
   V_B ≥ V_A × volRatio
   ```
3. **MACD 势能确认**

   ```text
   |Hv_B| ≤ |N_A| × macdRatio
   且 |Hv_B| ≥ minAbsEnergy          若启用
   ```
4. **可选严格谷值衰减**

   ```text
   |N_B| ≤ |N_A| × macdRatio          若 strictPeakDecay=true
   ```

### 4.3 锚定 hist，贴合第一轮描述

#### 看跌信号：正区段对

按顺序：

1. **价格确认**

   ```text
   PH_B ≥ PH_A × priceRatio
   ```
2. **成交量确认**

   ```text
   V_B ≥ V_A × volRatio
   ```
3. **MACD 势能确认**

   ```text
   P_B ≤ P_A × macdRatio
   且 P_B ≥ minAbsEnergy              若启用
   ```

#### 看涨信号：负区段对

按顺序：

1. **价格确认**

   ```text
   PL_B ≤ PL_A ÷ priceRatio
   ```
2. **成交量确认**

   ```text
   V_B ≥ V_A × volRatio
   ```
3. **MACD 势能确认**

   ```text
   |N_B| ≤ |N_A| × macdRatio
   且 |N_B| ≥ minAbsEnergy            若启用
   ```

### 4.4 信号确认与执行

- 信号在区段结束后的第一根异号 bar 确认。
- 下一根 bar 执行，避免追在极值 / 量峰尖上。
- 同一区段只触发一次。

---

## 5. 信号强度评分算法（0–10）

### 5.1 设计目标

- 刚好满足三个阈值时，强度分数 = `1`。
- 越超出阈值，分数越高，最高 `10`。
- 分数单调、可解释、便于回测比较。
- 支持可配置映射模式，避免固定非线性刻度带来的解释困难。
- 支持通过回测校准将强度分转为历史胜率与置信度。

### 5.2 各维度达标倍数

定义三个维度的“达标倍数”，合格时均 `≥ 1`，刚好满足时等于 `1`。

#### 价格达标倍数 `priceMult`

- 看跌：实际价格比率 = `PH_B / PH_A`
  ```text
  priceMult = (PH_B / PH_A) / priceRatio
  ```
- 看涨：实际价格比率 = `PL_A / PL_B`
  ```text
  priceMult = (PL_A / PL_B) / priceRatio
  ```
- 边界：若 `PL_B = 0`，`priceMult` 取上限 `scoreCap`，默认 `10`。

#### 成交量达标倍数 `volMult`

```text
volMult = (V_B / V_A) / volRatio
```

- 边界：若 `V_A = 0`，则 `volMult` 取上限 `scoreCap`。

#### MACD 达标倍数 `macdMult`

- 看跌：实际衰减倍数 = `P_A / Hv_B`，阈值 = `1 / macdRatio`
  ```text
  macdMult = (P_A / Hv_B) × macdRatio
  ```
- 看涨：实际衰减倍数 = `|N_A| / |Hv_B|`
  ```text
  macdMult = (|N_A| / |Hv_B|) × macdRatio
  ```
- 边界：若 `Hv_B` 或 `|Hv_B|` 为 `0` 或负，`macdMult` 取上限 `scoreCap`。
- 若 `strictPeakDecay=true`，可额外计算 `P_B` 或 `|N_B|` 对应的倍数，并与 `Hv` 倍数取较小值或加权，首版仅用 `Hv`。

### 5.3 综合强度因子

```text
I = priceMult × volMult × macdMult
```

- 刚好满足三阈值时：`I = 1 × 1 × 1 = 1`。
- `I ≥ 1` 为合格信号。
- `I` 越大，信号越强。

### 5.4 评分模式与映射

评分模式由 `scoreMode` 控制，支持以下模式：

#### 模式一：`saturating`，默认

公式：

```text
Score = 1 + 9 × (1 - 1 / I)
```

- `I = 1` 时，`Score = 1`。
- `I → ∞` 时，`Score → 10`。
- 低段涨得快，高段饱和，永远到不了 10。
- 无需 `scoreIMax`。

#### 模式二：`linear`，可配置 `scoreIMax`

公式：

```text
Score = 1 + 9 × min(1, (I - 1) / (scoreIMax - 1))
```

- `I = 1` 时，`Score = 1`。
- `I ≥ scoreIMax` 时，`Score = 10`。
- `scoreIMax` 可配置，默认 `5.0`，范围 `1.1–100`，步长 `0.5`。
- `scoreIMax` 越小，低 `I` 也能得到高分；越大，评分越线性、越严格。

#### 模式三：`calibrated`，回测校准模式

- 先按 `saturating` 或 `linear` 计算 `rawScore`。
- 再用回测校准表将 `I` 或 `rawScore` 映射为 `calibratedWinRate`。
- 实时交易可输出：
  - `strengthScore`：规则强度分
  - `calibratedWinRate`：历史校准胜率
  - `confidenceLower` / `confidenceUpper`：置信区间
  - `sampleSize`：样本数
- 若样本不足，则 `calibratedWinRate = null`，仅用 `strengthScore` 做相对排序。

### 5.5 示例

假设 `priceRatio=0.9`，`volRatio=0.8`，`macdRatio=0.2`。

| 场景                   |            价格倍数 |        量倍数 |         MACD倍数 |     I | saturating Score | linear Score（scoreIMax=5） |
| ---------------------- | ------------------: | ------------: | ---------------: | ----: | ---------------: | --------------------------: |
| 刚好合格               |                1.00 |          1.00 |             1.00 |  1.00 |              1.0 |                         1.0 |
| 价格 1.2×前高         | `(1.2/0.9)=1.333` |          1.00 |             1.00 | 1.333 |             3.25 |       `1+9×0.333/4=1.75` |
| 价格 1.5×前高         |           `1.667` |          1.00 |             1.00 | 1.667 |              4.6 |       `1+9×0.667/4=2.50` |
| 量 2×前量             |                1.00 | `2/0.8=2.5` |             1.00 |   2.5 |              6.4 |         `1+9×1.5/4=4.38` |
| MACD 衰减到 0.05×前峰 |                1.00 |          1.00 | `(0.2/0.05)=4` |   4.0 |             7.75 |           `1+9×3/4=7.75` |
| 三项均强               |                 1.5 |           2.0 |              3.0 |   9.0 |              9.0 |     `1+9×8/4=10`（截断） |

#### 用户示例：前低 7000，当前低点 6000

已知：

- `PL_A = 7000`
- `PL_B = 6000`
- `priceRatio = 0.98`
- `volMult = 1`
- `macdMult = 1`

价格达标倍数：

```text
priceMult = (7000 / 6000) / 0.98
          = 1.1666667 / 0.98
          = 1.1904762
```

综合强度因子：

```text
I = 1.1904762 × 1 × 1
  = 1.1904762
```

不同模式结果：

- `saturating`：

  ```text
  Score = 1 + 9 × (1 - 1 / 1.1904762)
        = 2.44
  ```
- `linear`，`scoreIMax = 5`：

  ```text
  Score = 1 + 9 × min(1, (1.1904762 - 1) / (5 - 1))
        = 1 + 9 × 0.047619
        = 1.43
  ```
- `linear`，`scoreIMax = 2`：

  ```text
  Score = 1 + 9 × min(1, (1.1904762 - 1) / (2 - 1))
        = 1 + 9 × 0.190476
        = 2.71
  ```
- `linear`，`scoreIMax = 1.5`：

  ```text
  Score = 1 + 9 × min(1, (1.1904762 - 1) / (1.5 - 1))
        = 1 + 9 × 0.380952
        = 4.43
  ```

### 5.6 强度分级建议

|     Score | 含义                   |
| --------: | ---------------------- |
|         0 | 不合格                 |
|  1.0–2.9 | 弱合格，刚好达标或略强 |
|  3.0–5.9 | 中等强度，值得关注     |
|  6.0–8.9 | 强信号                 |
| 9.0–10.0 | 极强信号               |

注意：分级是相对规则分，不是概率。实际概率需回测校准。

### 5.7 在 TradeIntent 中输出

- `reason` 中附加：
  - `scoreMode`
  - `scoreIMax`（若 linear）
  - `score`：信号强度分数
  - `priceMult`、`volMult`、`macdMult`
  - `I`：综合强度因子
  - 各原始比率与阈值
  - `calibratedWinRate`、`confidenceLower`、`confidenceUpper`、`sampleSize`（若启用 calibrated 模式）
- 回测页可按 `score` 过滤或分组统计。

---

## 6. 参数规范 paramSpecs

| 参数名                    |    类型 |           默认 |                                         范围 | 步长 | 含义                                                                                                 |
| ------------------------- | ------: | -------------: | -------------------------------------------: | ---: | ---------------------------------------------------------------------------------------------------- |
| `fast`                  |  number |             12 |                                        2–50 |    1 | MACD 快 EMA 周期                                                                                     |
| `slow`                  |  number |             26 |                                       5–100 |    1 | MACD 慢 EMA 周期                                                                                     |
| `signal`                |  number |              9 |                                        2–50 |    1 | MACD 信号周期                                                                                        |
| `anchor`                |  string |     `volume` |                        `volume` / `hist` |   — | 锚定方式：量峰 / MACD 极值                                                                           |
| `priceRatio`            |  number |           0.9 |                                     0.1–2.0 | 0.05 | 价格确认比率。看跌：`PH_B ≥ PH_A × priceRatio`；看涨：`PL_B ≤ PL_A ÷ priceRatio`。越大越严格 |
| `volRatio`              |  number |            0.8 |                                     0.1–3.0 | 0.05 | 成交量确认比率。`V_B ≥ V_A × volRatio`。越大越严格                                               |
| `macdRatio`             |  number |            0.2 |                                    0.05–1.0 | 0.05 | MACD 势能衰减比率：新势能 ≤ 前势能 × 该值（越小要求衰减越明显，信号越强）                          |
| `volWindow`             |  number |              3 |                                        0–10 |    1 | 量峰邻域 ±N 根平均量；0 = 单根量                                                                    |
| `minAbsEnergy`          |  number |              0 |                                          ≥0 | 0.01 | 最小势能绝对值过滤，0 = 关闭；需按币种价格量级设置                                                   |
| `strictPeakDecay`       | boolean |          false |                                 true / false |   — | 仅`anchor=volume` 时生效；额外要求新区段 hist 峰值 / 谷值也衰减                                    |
| `sideMode`              |  string |       `both` |              `both` / `long` / `short` |   — | 双向 / 仅多 / 仅空                                                                                   |
| `trendFilter`           |  string |        `off` |                 `off` / `ema` / `zero` |   — | `ema`：价格在 EMA 上方才看涨、下方才看跌；`zero`：MACD 线在零轴上才看涨、零轴下才看跌            |
| `trendEmaPeriod`        |  number |             50 |                                       5–200 |    1 | 仅`trendFilter=ema` 时生效                                                                         |
| `sizePct`               |  number |            0.9 |                                      0.05–1 | 0.05 | 开仓比例，按可用权益                                                                                 |
| `takeProfitPct`         |  number |           0.05 |                                         0–1 | 0.01 | 浮盈达该比例平仓，0 = 关闭                                                                           |
| `stopLossPct`           |  number |           0.03 |                                         0–1 | 0.01 | 浮亏达该比例平仓，0 = 关闭                                                                           |
| `scoreMode`             |  string | `saturating` | `saturating` / `linear` / `calibrated` |   — | 评分模式                                                                                             |
| `scoreIMax`             |  number |            5.0 |                                     1.1–100 |  0.5 | 仅`scoreMode=linear` 生效；`I ≥ scoreIMax` 时得 10 分                                           |
| `scoreCap`              |  number |             10 |                                       1–100 |    1 | 各维度达标倍数上限，防止除零与极端值                                                                 |
| `scoreFilterMin`        |  number |              0 |                                        0–10 |  0.1 | 仅执行`Score ≥ scoreFilterMin` 的信号；0 = 关闭                                                   |
| `calibrationMinSamples` |  number |             30 |                                      1–1000 |    1 | 校准桶最小样本数，低于该值不输出校准胜率                                                             |
| `calibrationVersion`    |  string |         `""` |                                           — |   — | 校准表版本号，用于回测复现                                                                           |

### 参数校验与警告

- 建议 `fast < slow`，否则给出警告。
- `minAbsEnergy` 过大时可能导致信号永远无法触发。
- `sideMode` 与反手逻辑必须一致：
  - `both`：允许反手。
  - `long`：只开多、只持多；看跌信号仅平多，不反手开空。
  - `short`：只开空、只持空；看涨信号仅平空，不反手开多。
- `trendEmaPeriod` 仅在 `trendFilter=ema` 时生效。
- `priceRatio` 过大时信号稀少；过小时价格确认形同虚设。
- `volRatio` 过大时要求真放量，信号稀少；过小时量能确认力度下降。
- `macdRatio` 过大时势能衰减要求宽松，信号增多；过小时信号稀少但势能衰竭更显著。
- `scoreMode=linear` 时，`scoreIMax` 必须大于 `1`，否则评分无意义。
- `scoreCap` 用于处理除零与极端值，默认 `10`。
- `scoreFilterMin` 过大时可能过滤掉大量合格信号，建议回测确定。
- `calibrationMinSamples` 用于控制校准胜率输出的可靠性。

---

## 7. 算法流程，贴合项目 onBar 接口

输入：`ctx.bars` 已收盘 K 线，含当前 bar、`bar`、`index`、`ctx.indicators` 策略缓存。

```text
onBar:
  1. hist = macd(closes, fast, slow, signal).hist
     说明：当前引擎每根 bar 新建 ctx.indicators、不跨 bar 复用，故实现每次全量重算
     （与 macd_trend 一致），不依赖 indicators 缓存；若后续引擎支持跨 bar 缓存，可改为只算增量。

  2. 扫描 hist，切分区段序列：
     zones[] = { sign, start, end, P|N, V, Hv, PH|PL }
     区段结束点：当前 bar 与上一根 hist 异号
     → 上一区段 [start..i-1] 结束。

  3. 若当前 bar 刚确认一个区段 z 结束：
     取前一同向区段 zPrev，要求 zPrev.end < z.start。

  4. 第一步：价格确认
     - 看跌正区段对：
       PH_z = max(high, z.start..z.end)
       PH_zPrev = max(high, zPrev.start..zPrev.end)
       要求 PH_z ≥ PH_zPrev × priceRatio
     - 看涨负区段对：
       PL_z = min(low, z.start..z.end)
       PL_zPrev = min(low, zPrev.start..zPrev.end)
       要求 PL_z ≤ PL_zPrev ÷ priceRatio
     不满足 → 跳过，不再检查成交量与 MACD。

  5. 第二步：成交量确认
     计算 V_z 与 V_zPrev：
       - volWindow=0：取量峰 bar 单根量
       - volWindow>0：取量峰 bar 邻域 ±volWindow 根的成交量均值
     要求：
       V_z ≥ V_zPrev × volRatio
     不满足 → 跳过，不再检查 MACD。

  6. 第三步：MACD 势能确认
     - anchor=volume：
       看跌：Hv_z ≤ P_zPrev × macdRatio
       看涨：|Hv_z| ≤ |N_zPrev| × macdRatio
     - anchor=hist：
       看跌：P_z ≤ P_zPrev × macdRatio
       看涨：|N_z| ≤ |N_zPrev| × macdRatio
     不满足 → 不生成信号。

  7. 第四步：附加过滤
     - minAbsEnergy，若启用；
     - strictPeakDecay，若启用；
     - trendFilter；
     - sideMode。

  8. 计算信号强度评分：
     - priceMult = 实际价格比率 / priceRatio
     - volMult   = 实际量比率 / volRatio
     - macdMult  = 实际衰减倍数 / (1/macdRatio)
     - 各自取 min(值, scoreCap)
     - I = priceMult × volMult × macdMult
     - 若 scoreMode=saturating:
         Score = I>=1 ? 1 + 9 × (1 - 1/I) : 0
     - 若 scoreMode=linear:
         Score = I>=1 ? 1 + 9 × min(1, (I - 1)/(scoreIMax - 1)) : 0
     - 若 scoreMode=calibrated:
         先按 saturating 或 linear 计算 rawScore
         再查校准表得 calibratedWinRate、confidenceLower、confidenceUpper、sampleSize
     - Score 截断到 [0, 10]
     - 若 scoreFilterMin > 0 且 Score < scoreFilterMin → 跳过

  9. 命中且 z.end 未被 lastSignalZone 记录过：
     生成信号。

  10. 生成 TradeIntent：
     - 看跌：
       both 且持多 → CLOSE 反手 OPEN_SHORT；
       both 且空仓 → OPEN_SHORT；
       long-only 且持多 → CLOSE；
       long-only 且空仓 → 无动作；
       short-only 且空仓 → OPEN_SHORT。
     - 看涨：
       both 且持空 → CLOSE 反手 OPEN_LONG；
       both 且空仓 → OPEN_LONG；
       short-only 且持空 → CLOSE；
       short-only 且空仓 → 无动作；
       long-only 且空仓 → OPEN_LONG。

  11. 只有实际生成交易动作时，才记录 lastSignalZone = z.end。

  12. reason 包含：
      anchor、价格比、量比、MACD 衰减比、priceMult、volMult、macdMult、I、Score、
      scoreMode、scoreIMax、calibratedWinRate、confidenceLower、confidenceUpper、sampleSize、
      zPrev 区间、z 区间
      便于复盘。
```

### 实现要点

- 区段扫描每次 `onBar` 全量重扫，首版保证确定性；后续可做增量缓存。
- 当前引擎每根 bar 新建 `ctx.indicators`（不跨 bar 缓存）→ 每次 `onBar` 全量重算 hist 与区段；
  区段去重用策略实例闭包 `lastSignalZone`（仅记录实际发单区段），不写入 `ctx.indicators`。
- 判定顺序严格为：价格 → 成交量 → MACD 势能。前一步不满足时，后续步骤短路跳过。
- 信号强度评分在第三步通过后计算，不影响信号是否触发，仅作为附加信息。
- 信号在区段结束后的异号 bar 确认，下一根执行，避免追在极值 / 量峰尖上。
- 反手优先返回组合意图；若项目 TradeIntent 不支持同 bar `CLOSE + OPEN`，则拆分为同 bar 顺序执行，或下一根先平、再下一根开。
- 固定止盈止损若与信号同 bar 触发，建议风险优先：先检查 TP/SL，再评估新信号。

---

## 8. 进出场与风险管理

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
| 强度过滤           | `scoreFilterMin` 可过滤低分信号                                                      |
| 置信度参考         | 若启用`calibrated`，可用 `calibratedWinRate` 与置信区间辅助仓位决策                |

---

## 9. 回测验证方案

注册后回测页可直接选择 `macd_energy_reversal`，兼容别名 `macd_energy`。

### 基准对比

- `macd_trend`：趋势型基准。
- `rsi`：反转型基准。

### 建议跑组

行情连通后：

- 品种 / 周期：BTCUSDT 1h / 4h / 1d；ETHUSDT 1h。
- 时间窗：90 天 / 180 天。
- 参数敏感性：
  - `priceRatio ∈ {0.8, 0.9, 0.98, 1.0, 1.1}`
  - `volRatio ∈ {0.7, 0.8, 1.0, 1.5}`
  - `macdRatio ∈ {0.1, 0.2, 0.3, 0.5}`
  - `anchor ∈ {volume, hist}`
  - `strictPeakDecay ∈ {false, true}`
  - `scoreMode ∈ {saturating, linear, calibrated}`
  - `scoreIMax ∈ {1.5, 2, 3, 5, 10}`
  - `scoreFilterMin ∈ {0, 1, 3, 5}`

### 观察指标

- 胜率
- 盈亏比
- 最大回撤
- 交易次数
- 平均持仓时长
- 信号触发频率
- 各比率实际分布
- `Score` 分布与不同 `Score` 区间的绩效
- `I` 分布与不同 `I` 区间的绩效
- 校准胜率与实际胜率的偏差

反转策略重点看盈亏比与回撤，不追求高胜率。

### 行情不可达期间

用 mock 数据先验证信号触发逻辑的正确性与幂等性，单元测试覆盖：

- 看跌信号：价格 ≥ 前高 × `priceRatio` + 量 ≥ 前量 × `volRatio` + MACD 正势能 ≤ 前势能 × `macdRatio`
- 看涨信号：价格 ≤ 前低 ÷ `priceRatio` + 量 ≥ 前量 × `volRatio` + MACD 负势能绝对值 ≤ 前势能绝对值 × `macdRatio`
- 价格确认失败时不触发
- 成交量确认失败时不触发
- MACD 势能确认失败时不触发
- 判定顺序短路正确：价格失败不检查量，量失败不检查 MACD
- 强度评分：
  - `saturating`：刚好合格 `Score=1`
  - `linear`：`scoreIMax` 可配置，`I ≥ scoreIMax` 时 `Score=10`
  - `calibrated`：样本不足时输出 `null`
- 除零与 `scoreCap` 边界
- `scoreFilterMin` 过滤
- 反手
- `sideMode` 过滤
- 去重
- `strictPeakDecay`
- `volWindow`
- 量峰并列
- 参数边界

---

## 10. 信号强度校准与置信度（回测）

### 10.1 目标

- 将规则强度分 `Score` 或综合强度因子 `I` 映射为历史校准胜率。
- 输出置信区间，避免把规则分误认为概率。
- 支持冷启动与样本不足处理。
- 支持按品种、周期、方向、市场状态分别校准。

### 10.2 数据采集字段

每个信号至少采集：

| 字段                                          | 说明                                    |
| --------------------------------------------- | --------------------------------------- |
| `signalId`                                  | 信号唯一 ID                             |
| `timestamp`                                 | 信号确认时间                            |
| `symbol`                                    | 品种                                    |
| `timeframe`                                 | 周期                                    |
| `direction`                                 | 看涨 / 看跌                             |
| `anchor`                                    | 锚定方式                                |
| `priceRatio` / `volRatio` / `macdRatio` | 参数                                    |
| `priceMult` / `volMult` / `macdMult`    | 各维度达标倍数                          |
| `I`                                         | 综合强度因子                            |
| `score`                                     | 规则强度分                              |
| `scoreMode` / `scoreIMax`                 | 评分模式                                |
| `entryPrice`                                | 入场价                                  |
| `exitPrice`                                 | 出场价                                  |
| `pnl`                                       | 盈亏                                    |
| `maxFavorableExcursion`                     | 最大有利变动                            |
| `maxAdverseExcursion`                       | 最大不利变动                            |
| `horizonReturn`                             | 未来 N 根收益                           |
| `tpFirst`                                   | 止盈是否先触发                          |
| `slFirst`                                   | 止损是否先触发                          |
| `marketRegime`                              | 市场状态：震荡 / 趋势 / 高波动 / 低波动 |

### 10.3 分桶与统计

- 按 `I` 或 `Score` 分桶，建议等频分桶。
- 示例桶：
  ```text
  I: [1, 1.2), [1.2, 1.5), [1.5, 2), [2, 3), [3, 5), [5, 10), [10+)
  Score: [1, 2), [2, 3), [3, 5), [5, 7), [7, 9), [9, 10]
  ```
- 每桶统计：
  - 样本数 `n`
  - 胜率 `p`
  - 盈亏比
  - 期望收益
  - 95% Wilson 置信区间
- 若 `n < calibrationMinSamples`，该桶不输出校准胜率，或输出低置信标记。

Wilson 置信区间公式：

```text
p_hat = 胜率
z = 1.96  // 95%
denom = 1 + z^2 / n
center = (p_hat + z^2 / (2n)) / denom
half = z * sqrt(p_hat * (1 - p_hat) / n + z^2 / (4n^2)) / denom
lower = center - half
upper = center + half
```

### 10.4 校准模型

可选以下模型：

1. **等渗回归（Isotonic Regression）**

   - 保证校准胜率随 `I` 或 `Score` 单调递增。
   - 适合信号强度与胜率单调相关的假设。
2. **Platt Scaling**

   - 逻辑回归：
     ```text
     logit(p) = a × log(I) + b
     或 logit(p) = a × Score + b
     ```
   - 适合平滑映射。
3. **Beta 校准**

   - 贝叶斯平滑，适合小样本桶。
   - 输出后验胜率与可信区间。

### 10.5 输出字段

实时或回测输出：

| 字段                    | 说明         |
| ----------------------- | ------------ |
| `strengthScore`       | 规则强度分   |
| `rawI`                | 综合强度因子 |
| `calibratedWinRate`   | 历史校准胜率 |
| `confidenceLower`     | 置信区间下界 |
| `confidenceUpper`     | 置信区间上界 |
| `sampleSize`          | 校准桶样本数 |
| `calibrationBucket`   | 所属桶       |
| `calibrationVersion`  | 校准表版本   |
| `calibrationReliable` | 样本是否充足 |

### 10.6 冷启动与样本不足

- 样本不足时：
  - `calibratedWinRate = null`
  - `calibrationReliable = false`
  - 仅使用 `strengthScore` 做相对排序。
- 可设置先验胜率，如 `50%`，并随样本增加逐步更新。
- 不同品种、周期、方向应分别校准；样本不足时可回退到全局校准。

### 10.7 防过拟合

- 使用样本外验证：训练集 / 验证集 / 测试集。
- 使用滚动窗口校准：例如每 90 天重新校准。
- 避免未来函数：校准表只能使用信号确认时已知的数据。
- 参数选择与校准分开：先固定参数，再校准；或使用嵌套交叉验证。
- 关注校准后的盈亏比与回撤，而非单纯胜率。

### 10.8 与执行结合

- `scoreFilterMin`：只执行 `Score ≥ 阈值` 的信号。
- `calibratedWinRate`：可用于仓位调节，例如：
  ```text
  size = sizePct × clamp(calibratedWinRate / 0.5, 0.5, 1.5)
  ```
- 置信区间过宽时降低仓位。
- 样本不足时不做重仓。

---

## 11. 适用场景与已知局限

### 适用

- 震荡市。
- 拐点识别。
- 放量滞涨与放量抗跌的变盘捕捉。
- 价格创新低但 MACD 负动能衰竭，且量能承接。
- 价格创新高但 MACD 正动能衰竭，且量能放大。
- 多周期共振时信号更强。
- 通过 `Score` 分级执行，可提升信号质量。
- 通过回测校准，可将强度分转为历史胜率与置信区间。

### 已知局限

- 极值 / 量峰确认滞后 1 根 bar，可接受，换取不追高。
- 小周期 <15m 量能噪音大，建议 1h+。
- 单边强趋势中反向信号频繁，建议开启 `trendFilter` 或仅在震荡行情启用。
- `macdRatio` 过小信号稀少，过大噪音增多；`0.1–0.3` 为推荐区间。
- `priceRatio` 过大信号稀少，过小价格确认形同虚设；`0.8–1.0` 为推荐区间。
- `volRatio` 过大要求真放量，信号稀少；过小量能确认力度下降；`0.7–1.0` 为推荐区间。
- `minAbsEnergy` 需按币种价格量级设置，默认关闭；设置过大可能导致无信号。
- `anchor=volume` 默认只检查量峰处 hist，不检查新区段 hist 峰值；若需更严格，启用 `strictPeakDecay`。
- 价格默认使用区段 high/low，可能受插针影响；可调大 `priceRatio` 或后续扩展 `priceSource=close`。
- 量峰并列时已定义取更靠近区段结束的 bar，保证确定性。
- 判定顺序固定为价格 → 成交量 → MACD，若价格或成交量不满足，不会继续评估 MACD。
- 强度评分不是概率，必须回测校准才能解释为置信度。
- `linear` 模式下 `scoreIMax` 选择影响很大，需回测确定。
- 校准表可能过拟合，需样本外验证与滚动更新。

---

## 12. 实现与交付计划

> 进度：步骤 1–5 已完成（策略实现、注册、单元测试、校准模块、`pnpm typecheck` + `pnpm test` 全绿）；
> 步骤 6 依赖 Binance 行情连通后执行。

| 步骤 | 内容                                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 新建`packages/strategy/src/builtin/macdEnergyReversal.ts`，实现 `createMacdEnergyReversalStrategy()`，含 `describe`；可导出兼容别名 `createMacdEnergyStrategy()`                                                                                                                                                  |
| 2    | 注册进`packages/strategy/src/builtin/index.ts`，主 ID `macd_energy_reversal`，兼容别名 `macd_energy`                                                                                                                                                                                                                |
| 3    | 单元测试`packages/strategy/test/macdEnergyReversal.test.ts`：构造价格、成交量、MACD 三重比率确认 K 线序列，验证看跌 / 看涨信号、价格确认失败、量能确认失败、MACD 确认失败、判定顺序短路、强度评分各模式、除零边界、`scoreFilterMin`、反手、`sideMode`、去重、`strictPeakDecay`、`volWindow`、量峰并列、参数边界 |
| 4    | 回测校准模块：`packages/strategy/src/calibration/macdEnergyCalibration.ts`，实现分桶、Wilson 区间、等渗回归 / Platt scaling、校准表导出                                                                                                                                                                                 |
| 5    | `pnpm typecheck` + `pnpm test` 全绿                                                                                                                                                                                                                                                                                   |
| 6    | 行情连通后跑真实回测并对比基准策略，输出校准报告                                                                                                                                                                                                                                                                          |

**前置依赖**：Binance 行情连通。当前网络不可达时，真实回测无法执行，见 README 排查章节 / `docs/hosts-binance.txt`。

---

## 13. 一句话定位

> **MACD 量价势能衰竭反转**：在相邻同向 MACD 波形之间，按“先价格、再成交量、后 MACD 势能”的顺序三重比率确认。价格达到前极值的至少 `priceRatio` 倍、成交量达到前量的至少 `volRatio` 倍、MACD 势能衰减到前势能的至多 `macdRatio` 倍时，捕捉放量滞涨、放量抗跌与价格创新低/高但动能衰竭的变盘反转。默认 `priceRatio=0.9`、`volRatio=0.8`、`macdRatio=0.2`。信号强度支持 `saturating` / `linear` / `calibrated` 模式，`scoreIMax` 可配置。规则强度分不是概率，需通过回测校准为历史胜率与置信区间。
