import type { Strategy, StrategyContext, TradeIntent } from '../strategy.ts';
import { bool, num } from '../strategy.ts';
import { ema, macd } from '@agentwin/core';
import { lookupCalibration, type MacdEnergyCalibrationTable } from '../calibration/macdEnergyCalibration.ts';

/**
 * MACD 量价势能衰竭反转（Momentum Exhaustion Reversal，策略 ID `macd_energy_reversal`）。
 *
 * 核心思想（见 docs/macd-energy-reversal_strategy.md）：
 * 相邻两个同向 MACD 波形（hist 同号区段）之间，按固定顺序三重比率确认：
 *   1) 价格确认：价格达到前极值的至少 priceRatio 倍（看跌 PH_B ≥ PH_A×priceRatio；
 *      看涨 PL_B ≤ PL_A÷priceRatio）；
 *   2) 成交量确认：V_B ≥ V_A × volRatio；
 *   3) MACD 势能确认：新势能 ≤ 前势能 × macdRatio。
 * 前一步不满足即硬性短路，不再检查后续步骤。
 *
 * 命中后计算 0–10 信号强度评分（scoreMode = saturating / linear / calibrated），
 * 评分不作为触发条件，仅用于排序、过滤（scoreFilterMin）与回测校准。
 *
 * 锚定方式：
 * - anchor=volume（默认）：以区段内量峰 bar 的 hist（Hv）为新区段势能；
 * - anchor=hist：以区段 hist 极值（P/N）为新区段势能。
 *
 * 信号在区段结束后的第一根异号 bar 确认、下一根 bar 执行，避免追在极值/量峰尖上；
 * 同一区段天然只触发一次。
 *
 * 引擎约束：
 * - 引擎每根 bar 新建 ctx.indicators（不可跨 bar 缓存）→ 每次全量重算 macd（与 macd_trend 一致）；
 * - ctx 无持仓成本 → 用闭包记录入场价，自行实现 TP/SL（风险优先于新信号）；
 * - USDT-M 引擎 allowReversal=true 支持同 bar 反手（OPEN_SHORT = 平多+开空，size=1 全额转向）；
 * - SPOT 引擎忽略 OPEN_SHORT → 看跌信号在 SPOT 仅平多、不反手开空。
 */

/** 区段：hist 连续同号的一段已结束 K 线区间 */
export interface Zone {
  sign: 1 | -1; // 1=正区段（hist>0），-1=负区段（hist<0）
  start: number; // 起始 bar index（含）
  end: number; // 结束 bar index（含）
  peak: number; // 正区段 max(hist) / 负区段 min(hist)（负值）
  volPeakIdx: number; // 量峰 bar index（并列取更靠近 end，保证确定性）
  vol: number; // 区段量能（量峰邻域 ±volWindow 均值，越界按区段内截断；volWindow=0 取单根量）
  hv: number; // 量峰处 hist 值
  ph: number; // 区段价格高点 max(high)
  pl: number; // 区段价格低点 min(low)
}

/** hist 符号；hist=0 延续上一符号（浮点下极少见，避免产生碎区段） */
function signOf(h: number | null | undefined, last: 1 | -1 | null): 1 | -1 | null {
  if (h == null) return null;
  if (h > 0) return 1;
  if (h < 0) return -1;
  return last ?? 1;
}

/** 区段量能：量峰邻域 ±window 根的成交量均值；越界按区段 [start..end] 截断，不跨异向区段 */
export function zoneVol(vols: number[], peakIdx: number, start: number, end: number, window: number): number {
  if (window <= 0) return vols[peakIdx] ?? 0;
  const lo = Math.max(start, peakIdx - window);
  const hi = Math.min(end, peakIdx + window);
  let sum = 0;
  let n = 0;
  for (let i = lo; i <= hi; i++) {
    sum += vols[i] ?? 0;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * 扫描 hist 截至 limit 的已结束区段序列（进行中的区段不返回，未结束不参与信号）。
 * 区段结束点：hist 符号翻转处（翻转前一根为该区段 end）。
 */
export function scanZones(
  H: (number | null)[],
  highs: number[],
  lows: number[],
  vols: number[],
  limit: number,
  volWindow: number,
): Zone[] {
  const zones: Zone[] = [];
  let start = -1;
  let sign: 1 | -1 | null = null;
  let peak = 0;
  let volPeakIdx = -1;
  let volPeakVol = -1;
  let hv = 0;
  let ph = -Infinity;
  let pl = Infinity;

  const begin = (i: number, s: 1 | -1) => {
    start = i;
    sign = s;
    peak = H[i] ?? 0;
    volPeakIdx = i;
    volPeakVol = vols[i] ?? 0;
    hv = H[i] ?? 0;
    ph = highs[i] ?? -Infinity;
    pl = lows[i] ?? Infinity;
  };
  const flush = (end: number) => {
    if (start < 0 || sign === null) return;
    zones.push({
      sign, start, end, peak,
      volPeakIdx, vol: zoneVol(vols, volPeakIdx, start, end, volWindow), hv,
      ph: Number.isFinite(ph) ? ph : 0,
      pl: Number.isFinite(pl) ? pl : 0,
    });
    start = -1;
    sign = null;
  };

  for (let i = 0; i <= limit; i++) {
    const s = signOf(H[i], sign);
    if (s === null) {
      if (start >= 0) flush(i - 1); // warmup 中间断裂（理论不发生），强制结束当前区段
      continue;
    }
    if (start < 0) {
      begin(i, s);
      continue;
    }
    if (s !== sign) {
      flush(i - 1);
      begin(i, s);
      continue;
    }
    // 同符号延续：更新极值与量峰（量峰并列取更靠近 end，即后出现者胜）
    const h = H[i] ?? 0;
    if ((sign === 1 && h > peak) || (sign === -1 && h < peak)) peak = h;
    const hh = highs[i];
    if (hh !== undefined && hh > ph) ph = hh;
    const ll = lows[i];
    if (ll !== undefined && ll < pl) pl = ll;
    const v = vols[i] ?? 0;
    if (v >= volPeakVol) {
      volPeakVol = v;
      volPeakIdx = i;
      hv = h;
    }
  }
  // 进行中的区段不 flush：未确认结束，不参与信号
  return zones;
}

/** 评分与校准查询结果（文档 §5、§10.5） */
export interface ScoreResult {
  priceMult: number;
  volMult: number;
  macdMult: number;
  /** 综合强度因子 I = priceMult × volMult × macdMult */
  i: number;
  /** 规则强度分（截断到 0–10） */
  score: number;
  scoreMode: string;
  scoreIMax: number;
  scoreCap: number;
  /** 校准查询结果（仅 scoreMode=calibrated 且命中校准表时非空） */
  calibration: {
    bucket: [number, number];
    sampleSize: number;
    calibratedWinRate: number | null;
    confidenceLower: number | null;
    confidenceUpper: number | null;
    reliable: boolean;
  } | null;
}

export interface ScoreInputs {
  /** 实际价格比率：看跌 PH_B/PH_A；看涨 PL_A/PL_B */
  priceActualRatio: number;
  /** 实际量比率：V_B/V_A */
  volActualRatio: number;
  /** 实际 MACD 衰减倍数：看跌 P_A/Hv_B；看涨 |N_A|/|Hv_B| */
  macdActualRatio: number;
  priceRatio: number;
  volRatio: number;
  macdRatio: number;
  scoreMode: string;
  scoreIMax: number;
  scoreCap: number;
  calibration?: MacdEnergyCalibrationTable | null;
  calibrationMinSamples?: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 信号强度评分（文档 §5）：各维度达标倍数 → I → 0–10 分。
 * 刚好满足三阈值时 I=1、Score=1；越强越高，最高 10。
 */
export function computeScore(inp: ScoreInputs): ScoreResult {
  const cap = Math.max(1, inp.scoreCap);
  const mult = (m: number) => (Number.isFinite(m) ? clamp(m, 0, cap) : cap);
  const priceMult = mult(inp.priceActualRatio / Math.max(inp.priceRatio, 1e-12));
  const volMult = mult(inp.volActualRatio / Math.max(inp.volRatio, 1e-12));
  const macdMult = mult(inp.macdActualRatio * inp.macdRatio);
  const I = priceMult * volMult * macdMult;

  const mode = inp.scoreMode === 'linear' || inp.scoreMode === 'calibrated' ? inp.scoreMode : 'saturating';
  let rawScore: number;
  if (I < 1 || !Number.isFinite(I)) {
    rawScore = 0;
  } else if (mode === 'linear') {
    const imax = Math.max(inp.scoreIMax, 1.0001);
    rawScore = 1 + 9 * Math.min(1, (I - 1) / (imax - 1));
  } else {
    rawScore = 1 + 9 * (1 - 1 / I);
  }
  const score = clamp(rawScore, 0, 10);

  let calibration: ScoreResult['calibration'] = null;
  if (mode === 'calibrated') {
    const look = lookupCalibration(inp.calibration, I, inp.calibrationMinSamples);
    if (look) {
      calibration = {
        bucket: look.calibrationBucket,
        sampleSize: look.sampleSize,
        calibratedWinRate: look.calibratedWinRate,
        confidenceLower: look.confidenceLower,
        confidenceUpper: look.confidenceUpper,
        reliable: look.reliable,
      };
    }
  }

  return {
    priceMult, volMult, macdMult, i: I, score, scoreMode: mode,
    scoreIMax: inp.scoreIMax, scoreCap: cap, calibration,
  };
}

/** 检测命中结果 */
export interface SignalHit {
  dir: 'bull' | 'bear';
  z: Zone;
  zp: Zone;
  score: ScoreResult;
  detail: string;
}

export interface DetectOptions {
  anchor: string;
  priceRatio: number;
  volRatio: number;
  macdRatio: number;
  minAbsEnergy: number;
  strictPeakDecay: boolean;
  scoreMode: string;
  scoreIMax: number;
  scoreCap: number;
  calibration?: MacdEnergyCalibrationTable | null;
  calibrationMinSamples?: number;
  /** 可选：记录判定顺序（price/vol/macd），用于验证硬性短路 */
  trace?: string[];
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * 三重比率确认（固定顺序：价格 → 成交量 → MACD，硬性短路）+ 强度评分。
 * 返回命中的 SignalHit 或 null。
 */
export function detectSignal(z: Zone, zp: Zone | null, o: DetectOptions): SignalHit | null {
  if (!zp || zp.sign !== z.sign) return null;
  const trace = o.trace;

  const bear = z.sign === 1;
  // 各维度实际比率（越过阈值时 ≥ 1）
  let priceActualRatio: number;
  let macdActualRatio: number;
  let newE: number;
  let oldE: number;

  // ---- 第一步：价格确认 ----
  trace?.push('price');
  const cap = Math.max(o.scoreCap, 1);
  const capPrice = cap * o.priceRatio; // 使 priceMult 恰好取上限 scoreCap
  const capVol = cap * o.volRatio;
  const capMacd = cap / Math.max(o.macdRatio, 1e-12);
  if (bear) {
    if (!(z.ph >= zp.ph * o.priceRatio)) return null;
    priceActualRatio = zp.ph > 0 ? z.ph / zp.ph : capPrice;
    newE = o.anchor === 'volume' ? z.hv : z.peak;
    oldE = zp.peak;
    macdActualRatio = newE > 0 && oldE > 0 ? oldE / newE : capMacd;
  } else {
    if (!(z.pl <= (zp.pl > 0 ? zp.pl / o.priceRatio : Infinity))) return null;
    priceActualRatio = z.pl > 0 ? zp.pl / z.pl : capPrice;
    newE = o.anchor === 'volume' ? Math.abs(z.hv) : Math.abs(z.peak);
    oldE = Math.abs(zp.peak);
    macdActualRatio = newE > 0 && oldE > 0 ? oldE / newE : capMacd;
  }

  // ---- 第二步：成交量确认 ----
  trace?.push('vol');
  if (!(z.vol >= zp.vol * o.volRatio)) return null;
  const volActualRatio = zp.vol > 0 ? z.vol / zp.vol : capVol;

  // ---- 第三步：MACD 势能确认 ----
  trace?.push('macd');
  if (!(newE <= oldE * o.macdRatio)) return null;
  if (o.minAbsEnergy > 0 && !(Math.abs(newE) >= o.minAbsEnergy)) return null;
  if (o.anchor === 'volume' && o.strictPeakDecay) {
    const peakAbs = bear ? z.peak : Math.abs(z.peak);
    if (!(peakAbs <= oldE * o.macdRatio)) return null;
  }

  const score = computeScore({
    priceActualRatio, volActualRatio, macdActualRatio,
    priceRatio: o.priceRatio, volRatio: o.volRatio, macdRatio: o.macdRatio,
    scoreMode: o.scoreMode, scoreIMax: o.scoreIMax, scoreCap: o.scoreCap,
    calibration: o.calibration, calibrationMinSamples: o.calibrationMinSamples,
  });

  const dir: 'bull' | 'bear' = bear ? 'bear' : 'bull';
  const cal = score.calibration;
  const detail =
    (bear ? 'bear' : 'bull') +
    ' order=price>vol>macd anchor=' + o.anchor +
    ' 价 ' + round4(priceActualRatio) + '×/阈值' + o.priceRatio +
    ' 量 ' + round4(volActualRatio) + '×/阈值' + o.volRatio +
    ' 势能比 ' + round4(oldE > 0 ? newE / oldE : 0) + '≤' + o.macdRatio +
    ' priceMult=' + round4(score.priceMult) + ' volMult=' + round4(score.volMult) +
    ' macdMult=' + round4(score.macdMult) + ' I=' + round4(score.i) + ' Score=' + round4(score.score) +
    ' scoreMode=' + score.scoreMode +
    (score.scoreMode === 'linear' ? ' scoreIMax=' + score.scoreIMax : '') +
    (cal
      ? ' 校准胜率=' + (cal.calibratedWinRate === null ? 'null' : round4(cal.calibratedWinRate)) +
        ' 区间[' + (cal.confidenceLower === null ? 'null' : round4(cal.confidenceLower)) + ',' +
        (cal.confidenceUpper === null ? 'null' : round4(cal.confidenceUpper)) + ']' +
        ' 样本=' + cal.sampleSize + ' reliable=' + cal.reliable
      : score.scoreMode === 'calibrated'
        ? ' 校准胜率=null 样本=0 reliable=false（无校准表/样本不足）'
        : '') +
    ' zPrev[' + zp.start + '..' + zp.end + ']→z[' + z.start + '..' + z.end + ']';

  return { dir, z, zp, score, detail };
}

/** 趋势过滤：ema=价格相对 EMA；zero=MACD 线相对零轴（看涨需上方，看跌需下方） */
function trendOk(dir: 'bull' | 'bear', filter: string, closes: number[], macdLine: (number | null)[], emaPeriod: number): boolean {
  const lastClose = closes[closes.length - 1];
  if (lastClose === undefined) return true;
  if (filter === 'ema') {
    const e = ema(closes, emaPeriod);
    const v = e[e.length - 1];
    if (v == null) return true; // warmup 未完成，不拦截
    return dir === 'bull' ? lastClose > v : lastClose < v;
  }
  if (filter === 'zero') {
    const ml = macdLine[macdLine.length - 1];
    if (ml == null) return true;
    return dir === 'bull' ? ml > 0 : ml < 0;
  }
  return true;
}

/**
 * 按文档 sideMode 逻辑生成意图（延迟一根执行）。
 * - both：允许反手；long：只多，看跌仅平多；short：只空，看涨仅平空。
 * - USDT-M 反手用 size=1 全额转向（引擎 allowReversal 同 bar 平旧+开新，需开仓量 > 持仓量）；
 *   SPOT 引擎忽略 OPEN_SHORT，看跌信号仅平多。
 */
function reversalIntent(dir: 'bull' | 'bear', ctx: StrategyContext, sizePct: number, sideMode: string): TradeIntent | null {
  const side = ctx.positionSide;
  const usdtM = ctx.market === 'USDT_M';

  if (dir === 'bear') {
    if (sideMode === 'long') {
      return side === 'LONG'
        ? { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看跌信号（long-only）平多' }
        : null;
    }
    if (sideMode === 'short') {
      if (side === 'FLAT') return { action: 'OPEN_SHORT', sizeMode: 'pct', size: sizePct, reason: '看跌信号（short-only）开空' };
      if (side === 'LONG') return usdtM ? { action: 'OPEN_SHORT', sizeMode: 'pct', size: 1, reason: '看跌信号（short-only）平多反手' } : { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看跌信号（short-only）平多' };
      return null;
    }
    // both
    if (side === 'LONG') {
      return usdtM
        ? { action: 'OPEN_SHORT', sizeMode: 'pct', size: 1, reason: '看跌反手：动能衰竭+量能确认，平多开空' }
        : { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看跌信号（SPOT）平多' };
    }
    if (side === 'FLAT') {
      return usdtM
        ? { action: 'OPEN_SHORT', sizeMode: 'pct', size: sizePct, reason: '看跌信号：动能衰竭+量能确认，开空' }
        : null; // SPOT 无法做空
    }
    return null;
  }

  // bull
  if (sideMode === 'short') {
    return side === 'SHORT'
      ? { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看涨信号（short-only）平空' }
      : null;
  }
  if (sideMode === 'long') {
    if (side === 'FLAT') return { action: 'OPEN_LONG', sizeMode: 'pct', size: sizePct, reason: '看涨信号（long-only）开多' };
    if (side === 'SHORT') return usdtM ? { action: 'OPEN_LONG', sizeMode: 'pct', size: 1, reason: '看涨信号（long-only）平空反手' } : { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看涨信号（long-only）平空' };
    return null;
  }
  // both
  if (side === 'SHORT') {
    return usdtM
      ? { action: 'OPEN_LONG', sizeMode: 'pct', size: 1, reason: '看涨反手：空头衰竭+量能承接，平空开多' }
      : { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看涨信号平空' };
  }
  if (side === 'FLAT') return { action: 'OPEN_LONG', sizeMode: 'pct', size: sizePct, reason: '看涨信号：空头衰竭+量能承接，开多' };
  return null;
}

/**
 * 创建策略实例。
 * @param calibration 可选的校准表（文档 §10）；scoreMode=calibrated 时用于查询历史胜率与置信区间。
 */
export function createMacdEnergyReversalStrategy(calibration?: MacdEnergyCalibrationTable | null): Strategy {
  // 实例级闭包状态：一次回测/paper 运行内有效
  let pending: SignalHit | null = null; // 已确认、延迟一根执行的信号
  let entryPrice = 0; // 当前持仓入场价（引擎 ctx 不含持仓成本，自行记录用于 TP/SL）
  let lastSignalZone = -1; // 最近一次实际发单的区段 end index（去重标记）
  let warnedFastSlow = false;

  return {
    id: 'macd_energy_reversal',
    name: 'MACD 量价势能衰竭反转',
    description: '相邻同向 MACD 波形按“价格→成交量→MACD 势能”三重比率确认动能衰竭，捕捉放量滞涨/放量抗跌后的变盘反转，含 0–10 强度评分与回测校准。反转型。',
    paramSpecs: [
      { name: 'fast', type: 'number', default: 12, min: 2, max: 50, step: 1, description: 'MACD 快 EMA 周期' },
      { name: 'slow', type: 'number', default: 26, min: 5, max: 100, step: 1, description: 'MACD 慢 EMA 周期' },
      { name: 'signal', type: 'number', default: 9, min: 2, max: 50, step: 1, description: 'MACD 信号周期' },
      { name: 'anchor', type: 'string', default: 'volume', description: '锚定：volume=量峰处势能（默认）/ hist=区段极值' },
      { name: 'priceRatio', type: 'number', default: 0.9, min: 0.1, max: 2.0, step: 0.05, description: '价格确认比率：看跌 PH_B ≥ PH_A×该值；看涨 PL_B ≤ PL_A÷该值。越大越严格' },
      { name: 'volRatio', type: 'number', default: 0.8, min: 0.1, max: 3.0, step: 0.05, description: '量能确认比率：V_B ≥ V_A×该值。越大越严格' },
      { name: 'macdRatio', type: 'number', default: 0.2, min: 0.05, max: 1.0, step: 0.05, description: 'MACD 势能衰减比率：新势能 ≤ 前势能×该值。越小要求衰减越明显' },
      { name: 'volWindow', type: 'number', default: 3, min: 0, max: 10, step: 1, description: '量峰邻域 ±N 根平均量（0=单根量）' },
      { name: 'minAbsEnergy', type: 'number', default: 0, min: 0, max: 1e9, step: 0.01, description: '最小势能绝对值过滤（0=关闭；须低于典型旧势能×macdRatio，否则无信号）' },
      { name: 'strictPeakDecay', type: 'boolean', default: false, description: '仅 anchor=volume 生效：额外要求新区段 hist 极值也衰减' },
      { name: 'sideMode', type: 'string', default: 'both', description: 'both=双向可反手 / long=仅多 / short=仅空' },
      { name: 'trendFilter', type: 'string', default: 'off', description: 'off=关闭 / ema=价格相对 EMA / zero=MACD 线相对零轴' },
      { name: 'trendEmaPeriod', type: 'number', default: 50, min: 5, max: 200, step: 1, description: '仅 trendFilter=ema 生效' },
      { name: 'sizePct', type: 'number', default: 0.9, min: 0.05, max: 1, step: 0.05, description: '开仓比例（按可用权益）' },
      { name: 'takeProfitPct', type: 'number', default: 0.05, min: 0, max: 1, step: 0.01, description: '浮盈达该比例平仓（0=关闭）' },
      { name: 'stopLossPct', type: 'number', default: 0.03, min: 0, max: 1, step: 0.01, description: '浮亏达该比例平仓（0=关闭）' },
      { name: 'scoreMode', type: 'string', default: 'saturating', description: '评分模式：saturating=饱和(默认) / linear=线性(可配 scoreIMax) / calibrated=回测校准' },
      { name: 'scoreIMax', type: 'number', default: 5.0, min: 1.1, max: 100, step: 0.5, description: '仅 scoreMode=linear 生效：I ≥ 该值时得分 10' },
      { name: 'scoreCap', type: 'number', default: 10, min: 1, max: 100, step: 1, description: '各维度达标倍数上限，防止除零与极端值' },
      { name: 'scoreFilterMin', type: 'number', default: 0, min: 0, max: 10, step: 0.1, description: '仅执行 Score ≥ 该值的信号（0=关闭）' },
      { name: 'calibrationMinSamples', type: 'number', default: 30, min: 1, max: 1000, step: 1, description: '校准桶最小样本数，低于该值不输出校准胜率' },
      { name: 'calibrationVersion', type: 'string', default: '', description: '校准表版本号，用于回测复现' },
    ],
    onBar(ctx, bar, index): TradeIntent | null {
      const fast = Math.floor(num(ctx, 'fast'));
      const slow = Math.floor(num(ctx, 'slow'));
      const signalP = Math.floor(num(ctx, 'signal'));
      if (!warnedFastSlow && fast >= slow) {
        console.warn('[macd_energy_reversal] 建议 fast < slow，当前 fast=' + fast + ' slow=' + slow);
        warnedFastSlow = true;
      }
      const closes = ctx.bars.map((b) => b.close);
      const highs = ctx.bars.map((b) => b.high);
      const lows = ctx.bars.map((b) => b.low);
      const vols = ctx.bars.map((b) => b.volume);
      const m = macd(closes, fast, slow, signalP);
      const H = m.hist;
      // 归一化锚定方式：仅 'hist' 走区段极值，其余一律按默认 volume（含非法值回退）
      const anchor = String(ctx.params['anchor'] ?? 'volume') === 'hist' ? 'hist' : 'volume';
      const priceRatio = num(ctx, 'priceRatio');
      const volRatio = num(ctx, 'volRatio');
      const macdRatio = num(ctx, 'macdRatio');
      const volWindow = Math.floor(num(ctx, 'volWindow'));
      const minAbsEnergy = num(ctx, 'minAbsEnergy');
      const strictPeakDecay = bool(ctx, 'strictPeakDecay');
      const sideMode = String(ctx.params['sideMode'] ?? 'both');
      const trendFilter = String(ctx.params['trendFilter'] ?? 'off');
      const trendEmaPeriod = Math.floor(num(ctx, 'trendEmaPeriod'));
      const sizePct = num(ctx, 'sizePct');
      const tp = num(ctx, 'takeProfitPct');
      const sl = num(ctx, 'stopLossPct');
      const scoreMode = String(ctx.params['scoreMode'] ?? 'saturating');
      const scoreIMax = num(ctx, 'scoreIMax');
      const scoreCap = num(ctx, 'scoreCap');
      const scoreFilterMin = num(ctx, 'scoreFilterMin');
      const calibrationMinSamples = Math.floor(num(ctx, 'calibrationMinSamples'));

      // 1) TP/SL：风险优先（先于已确认信号与新区段信号；引擎按 bar.close 成交，与闭包记录入场价一致）
      if (entryPrice > 0 && ctx.positionSide !== 'FLAT') {
        const pnlPct = ctx.positionSide === 'LONG'
          ? (bar.close - entryPrice) / entryPrice
          : (entryPrice - bar.close) / entryPrice;
        if (tp > 0 && pnlPct >= tp) {
          entryPrice = 0;
          return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '止盈 ' + (pnlPct * 100).toFixed(2) + '%' };
        }
        if (sl > 0 && pnlPct <= -sl) {
          entryPrice = 0;
          return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '止损 ' + (pnlPct * 100).toFixed(2) + '%' };
        }
      }

      // 2) 执行已确认待执行的信号（上一根确认，本根执行，避免追在极值/量峰尖上）
      if (pending) {
        const p = pending;
        pending = null;
        const intent = reversalIntent(p.dir, ctx, sizePct, sideMode);
        if (intent) {
          if (intent.action === 'OPEN_LONG' || intent.action === 'OPEN_SHORT') entryPrice = bar.close;
          else if (intent.action === 'CLOSE') entryPrice = 0;
          lastSignalZone = p.z.end; // 只有实际生成交易动作时才记录去重标记
          return { ...intent, reason: intent.reason + '（' + p.detail + '）' };
        }
      }

      // 3) 新信号检测：当前 bar 与上一根 hist 异号 → 上一区段 [start..i-1] 刚结束
      const h1 = index > 0 ? (H[index - 1] ?? null) : null;
      const h0 = H[index] ?? null;
      if (h0 !== null && h1 !== null && signOf(h0, null) !== signOf(h1, null)) {
        // limit 取 index（含当前 bar）：扫描到当前翻转点，才把 [start..i-1] 作为已结束区段输出
        const zones = scanZones(H, highs, lows, vols, index, volWindow);
        const z = zones[zones.length - 1];
        if (z && z.end === index - 1 && z.end !== lastSignalZone) {
          // 最近一个已结束的同向区段（按时间向前搜索，稳健处理 warmup 断裂）
          let zp: Zone | null = null;
          for (let k = zones.length - 2; k >= 0; k--) {
            if (zones[k]!.sign === z.sign) { zp = zones[k]!; break; }
          }
          const hit = detectSignal(z, zp, {
            anchor, priceRatio, volRatio, macdRatio, minAbsEnergy, strictPeakDecay,
            scoreMode, scoreIMax, scoreCap, calibration, calibrationMinSamples,
          });
          if (hit && !(scoreFilterMin > 0 && hit.score.score < scoreFilterMin)) {
            if (trendOk(hit.dir, trendFilter, closes, m.macd, trendEmaPeriod)) {
              pending = hit; // 延迟一根执行
            }
          }
        }
      }
      return null;
    },
    describe(): string {
      return 'MACD 量价势能衰竭反转：比较相邻同向 MACD 波形，按固定顺序“价格→成交量→MACD 势能”三重比率确认动能衰竭。' +
        '第一步价格：看跌 PH_B ≥ PH_A×priceRatio（看涨 PL_B ≤ PL_A÷priceRatio）；' +
        '第二步成交量：V_B ≥ V_A×volRatio；第三步 MACD：锚定 volume 时 Hv_B ≤ P_A×macdRatio（anchor=hist 用区段极值 |P_B|/|N_B|），' +
        '前一步不满足即短路。命中后计算 0–10 强度评分：priceMult/volMult/macdMult 达标倍数相乘得 I，' +
        'scoreMode=saturating（Score=1+9×(1-1/I)）/ linear（Score=1+9×min(1,(I-1)/(scoreIMax-1))）/ calibrated（查校准表得 calibratedWinRate）。' +
        '参数：fast/slow/signal、anchor、priceRatio/volRatio/macdRatio、volWindow、minAbsEnergy、strictPeakDecay（要求新区段极值也衰减）、' +
        'trendFilter（ema/zero）、sideMode（both/long/short）、sizePct、takeProfitPct/stopLossPct、scoreMode/scoreIMax/scoreCap/scoreFilterMin、' +
        'calibrationMinSamples/calibrationVersion。信号在区段结束后的异号 bar 确认、下一根执行；反转型，建议 1h+ 周期、震荡/拐点行情使用。';
    },
  };
}

/** 兼容别名（文档：若已有引用/回测记录使用 macd_energy，可经此工厂创建同一策略） */
export function createMacdEnergyStrategy(calibration?: MacdEnergyCalibrationTable | null): Strategy {
  return createMacdEnergyReversalStrategy(calibration);
}
