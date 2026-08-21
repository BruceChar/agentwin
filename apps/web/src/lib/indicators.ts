// ================= 技术指标（前端纯函数计算） =================
// 口径与后端 packages/core 一致：MA=SMA，EMA=指数移动平均，MACD=DIF/DEA/柱，
// RSI=Wilder 平滑，VPVR=可见区间成交量分布。

export interface CandleView {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime?: number;
}

/**
 * 简单移动平均（SMA）；前 period-1 个位置为 null。
 * 支持小数周期（如 62.8）：窗口 = 最近 p+1 个值，最旧的值按小数部分加权，
 * 整数周期行为与原来完全一致。
 */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  const p = Math.floor(period);
  const f = period - p;
  const isFrac = f > 1e-9;
  const winSize = isFrac ? p + 1 : p; // 原始窗口内值的个数
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= winSize) sum -= values[i - winSize];
    if (i >= winSize - 1) {
      let total = sum;
      if (isFrac) total -= (1 - f) * values[i - (winSize - 1)];
      out[i] = total / period;
    }
  }
  return out;
}

/**
 * 指数移动平均（EMA）：以前 winSize 个值的小数 SMA 作为种子（整数周期即前 period 个值的 SMA）。
 * 支持小数周期（如 62.8）。
 */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length === 0) return out;
  const p = Math.floor(period);
  const f = period - p;
  const winSize = f > 1e-9 ? p + 1 : p;
  if (values.length < winSize) return out;
  const k = 2 / (period + 1);
  let prev = sma(values, period)[winSize - 1]!; // 种子：小数 SMA
  out[winSize - 1] = prev;
  for (let i = winSize; i < values.length; i++) {
    prev = (values[i] - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

/** 对含前导 null 的序列计算 EMA（跳过前导 null 再回填） */
function emaSkipNull(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const xs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] != null) {
      xs.push(values[i] as number);
      idx.push(i);
    }
  }
  if (xs.length < period) return out;
  const e = ema(xs, period);
  for (let i = 0; i < e.length; i++) {
    const v = e[i];
    if (v != null) out[idx[i] as number] = v;
  }
  return out;
}

export interface MacdResult {
  dif: (number | null)[];
  dea: (number | null)[];
  hist: (number | null)[];
}

/** MACD（国内口径）：DIF=EMA(fast)-EMA(slow)，DEA=EMA(signal, DIF)，柱=2*(DIF-DEA) */
export function macd(closes: number[], fast = 12, slow = 26, signal = 9): MacdResult {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const dif: (number | null)[] = closes.map((_, i) => (ef[i] == null || es[i] == null ? null : (ef[i] as number) - (es[i] as number)));
  const dea = emaSkipNull(dif, signal);
  const hist: (number | null)[] = dif.map((d, i) => (d == null || dea[i] == null ? null : (d - (dea[i] as number)) * 2));
  return { dif, dea, hist };
}

/** RSI（Wilder 平滑）；period 默认 14 */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface ProfileBucket {
  price: number; // 区间中心价
  lo: number;    // 区间下沿
  hi: number;    // 区间上沿
  volume: number;
}

/** VPVR：可见范围内将每根 K 线成交量按价格区间均摊，得到分价位成交量分布（含每个桶的 lo/hi 边界） */
export function volumeProfile(cs: CandleView[], buckets = 48): ProfileBucket[] {
  if (!cs.length) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const c of cs) {
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  }
  const step = (max - min) / buckets;
  if (!(step > 0)) {
    const total = cs.reduce((s, c) => s + c.volume, 0);
    return [{ price: (max + min) / 2, lo: min, hi: max, volume: total }];
  }
  const vols = new Array(buckets).fill(0) as number[];
  for (const c of cs) {
    if (!(c.volume > 0)) continue;
    const bot = Math.max(0, Math.floor((c.low - min) / step));
    const top = Math.min(buckets - 1, Math.floor((c.high - min) / step));
    const span = Math.max(1, top - bot + 1);
    const per = c.volume / span;
    for (let b = bot; b <= top; b++) vols[b] += per;
  }
  return vols.map((v, i) => ({
    price: min + step * (i + 0.5),
    lo: min + step * i,
    hi: min + step * (i + 1),
    volume: v,
  }));
}

/** 将 N 根 K 线按 factor 聚合（如 1周→2周）：开=首根开、收=末根收、高=最高、低=最低、量=求和 */
export function aggregateCandles(cs: CandleView[], factor: number): CandleView[] {
  const out: CandleView[] = [];
  for (let i = 0; i < cs.length; i += factor) {
    const g = cs.slice(i, i + factor);
    if (!g.length) break;
    out.push({
      openTime: g[0].openTime,
      open: g[0].open,
      high: Math.max(...g.map((c) => c.high)),
      low: Math.min(...g.map((c) => c.low)),
      close: g[g.length - 1].close,
      volume: g.reduce((s, c) => s + c.volume, 0),
      closeTime: g[g.length - 1].closeTime,
    });
  }
  return out;
}

/** K 线时间轴标签（按周期自适应） */
export function fmtAxisTime(t: number, interval: string): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  if (interval === '1M') return d.getFullYear() + '-' + p(d.getMonth() + 1);
  if (interval === '1d' || interval === '1w' || interval === '2w') return p(d.getMonth() + 1) + '-' + p(d.getDate());
  if (interval === '4h' || interval === '6h' || interval === '8h' || interval === '12h') {
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':00';
  }
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 工具提示完整时间 */
export function fmtTooltipTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 价格格式化：按数量级自适应小数位 */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(2);
  if (a >= 1) return v.toFixed(4);
  if (a >= 0.01) return v.toFixed(6);
  return v.toFixed(8);
}

/** 成交量格式化：K/M/B */
export function fmtVol(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(2);
}
