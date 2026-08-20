// ================= 技术指标 =================
// 所有指标返回与输入等长的数组，预热期（数据不足）位置为 null。

export type Series = (number | null)[];

/** 简单移动平均 */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指数移动平均 */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (prev === null) prev = v;
    else prev = v * k + prev * (1 - k);
    if (i >= period - 1) out[i] = prev;
  }
  return out;
}

/** RSI（Wilder 平滑） */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  out[period] = rsiValue(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = rsiValue(avgGain, avgLoss);
  }
  return out;
}

function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  hist: Series;
}

/** MACD（12/26/9 默认） */
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: Series = values.map((_, i) => {
    const f = emaFast[i] ?? null, s = emaSlow[i] ?? null;
    return f !== null && s !== null ? f - s : null;
  });
  const macdVals = macdLine.filter((v): v is number => v !== null);
  const offset = macdLine.findIndex((v) => v !== null);
  const sig = ema(macdVals, signalPeriod);
  const signalLine: Series = new Array(values.length).fill(null);
  for (let i = 0; i < sig.length; i++) {
    const s = sig[i] ?? null;
    if (s !== null && offset >= 0) signalLine[offset + i] = s;
  }
  const hist: Series = values.map((_, i) => {
    const m = macdLine[i] ?? null, s = signalLine[i] ?? null;
    return m !== null && s !== null ? m - s : null;
  });
  return { macd: macdLine, signal: signalLine, hist };
}

/** 平均真实波幅 */
export function atr(candles: { high: number; low: number; close: number }[], period = 14): Series {
  const trs: number[] = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (i === 0) { trs[i] = c.high - c.low; continue; }
    const pc = candles[i - 1]!.close;
    trs[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  }
  return ema(trs, period);
}

export interface BollingerResult {
  upper: Series;
  mid: Series;
  lower: Series;
}

/** 布林带 */
export function bollinger(values: number[], period = 20, mult = 2): BollingerResult {
  const mid = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i]!;
    const slice = values.slice(i - period + 1, i + 1);
    const sd = stdev(slice);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, mid, lower };
}

/** 标准差（总体） */
export function stdev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(sq);
}

/** 上穿：a[i-1] <= b[i-1] 且 a[i] > b[i] */
export function crossOver(a: Series, b: Series, i: number): boolean {
  if (i < 1) return false;
  const a0 = a[i - 1], b0 = b[i - 1], a1 = a[i], b1 = b[i];
  if (a0 == null || b0 == null || a1 == null || b1 == null) return false;
  return a0 <= b0 && a1 > b1;
}

/** 下穿：a[i-1] >= b[i-1] 且 a[i] < b[i] */
export function crossUnder(a: Series, b: Series, i: number): boolean {
  if (i < 1) return false;
  const a0 = a[i - 1], b0 = b[i - 1], a1 = a[i], b1 = b[i];
  if (a0 == null || b0 == null || a1 == null || b1 == null) return false;
  return a0 >= b0 && a1 < b1;
}

/** 取最新非空值 */
export function last<T>(arr: (T | null)[]): T | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null) return arr[i] as T;
  }
  return null;
}
