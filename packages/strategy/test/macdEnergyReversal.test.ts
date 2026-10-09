import { describe, expect, it } from 'vitest';
import type { Candle } from '@agentwin/shared';
import { defaultParams, normalizeParams, type StrategyContext, type TradeIntent } from '../src/strategy.ts';
import { builtinRegistry } from '../src/registry.ts';
import { registerBuiltinStrategies } from '../src/builtin/index.ts';
import {
  computeScore,
  createMacdEnergyReversalStrategy,
  createMacdEnergyStrategy,
  detectSignal,
  scanZones,
  type DetectOptions,
  type Zone,
} from '../src/builtin/macdEnergyReversal.ts';
import {
  buildCalibrationTable,
  isotonicRegression,
  lookupCalibration,
  parseCalibrationTable,
  serializeCalibrationTable,
  wilsonInterval,
  type MacdEnergyCalibrationTable,
} from '../src/calibration/macdEnergyCalibration.ts';

function bar(close: number, volume: number, t: number): Candle {
  return {
    openTime: t, open: close - 1, high: close + 1, low: close - 1, close, volume,
    closeTime: t + 1000, quoteVolume: 100, trades: 1, takerBuyBase: 0.5, takerBuyQuote: 50,
  };
}

const defaultDetect = (over: Partial<DetectOptions> = {}): DetectOptions => ({
  anchor: 'volume', priceRatio: 0.9, volRatio: 0.8, macdRatio: 0.2,
  minAbsEnergy: 0, strictPeakDecay: false, scoreMode: 'saturating', scoreIMax: 5, scoreCap: 10,
  ...over,
});

function zone(sign: 1 | -1, over: Partial<Zone> = {}): Zone {
  return { sign, start: 0, end: 10, peak: sign === 1 ? 1 : -1, volPeakIdx: 5, vol: 10, hv: sign === 1 ? 1 : -1, ph: 100, pl: 90, ...over };
}

/**
 * 看跌序列（default params 下命中）：陡涨 40（强正峰 + 大量）→ 回落 → 缓涨创新高区间（弱正峰 + 放量）→ 回落确认。
 * 价格：PH_B/PH_A ≈ 0.92 ≥ 0.9；量：V_B/V_A = 10 ≥ 0.8；MACD：Hv_B/Hv_A ≈ 0.12 ≤ 0.2。
 */
function bearSeries(): { closes: number[]; vols: number[] } {
  const closes: number[] = [100];
  for (let i = 0; i < 39; i++) closes.push(closes[closes.length - 1]! + 2 + i * 0.5);
  for (let i = 0; i < 20; i++) closes.push(closes[closes.length - 1]! - 2.5);
  for (let i = 0; i < 15; i++) closes.push(closes[closes.length - 1]! + 0.5);
  for (let i = 0; i < 3; i++) closes.push(closes[closes.length - 1]! - 2);
  const vols = closes.map((_, i) => (i < 40 ? 10 : i < 60 ? 15 : i - 60 < 5 ? 30 : 100));
  return { closes, vols };
}

/** 看涨序列：对称（陡跌 → 反弹 → 缓跌创新低区间 + 放量 → 反弹确认）；起点 1000 保证价格恒正 */
function bullSeries(): { closes: number[]; vols: number[] } {
  const closes: number[] = [1000];
  for (let i = 0; i < 39; i++) closes.push(closes[closes.length - 1]! - (2 + i * 0.5));
  for (let i = 0; i < 20; i++) closes.push(closes[closes.length - 1]! + 2.5);
  for (let i = 0; i < 15; i++) closes.push(closes[closes.length - 1]! - 0.5);
  for (let i = 0; i < 3; i++) closes.push(closes[closes.length - 1]! + 2);
  const vols = closes.map((_, i) => (i < 40 ? 10 : i < 60 ? 15 : i - 60 < 5 ? 30 : 100));
  return { closes, vols };
}

/**
 * strictPeakDecay 判别序列：正1 峰高 → 负 → 正2 陡涨（区段极值未衰减）但量峰放巨量在末段（hv 衰减）。
 * anchor=volume 默认：Hv 衰减 → 触发；strictPeakDecay=true：P_B 未衰减 → 不触发。
 */
function strictSeries(): { closes: number[]; vols: number[] } {
  const closes: number[] = [100];
  for (let i = 0; i < 39; i++) closes.push(closes[closes.length - 1]! + 2 + i * 0.35);
  for (let i = 0; i < 20; i++) closes.push(closes[closes.length - 1]! - 3);
  for (let i = 0; i < 12; i++) closes.push(closes[closes.length - 1]! + 1.5); // 陡涨：hist 峰高
  for (let i = 0; i < 10; i++) closes.push(closes[closes.length - 1]! + 0.05); // 横盘微升：hist 衰减但仍正，放巨量
  for (let i = 0; i < 3; i++) closes.push(closes[closes.length - 1]! - 1); // 触发确认
  const vols = closes.map((_, i) => (i < 40 ? 10 : i < 60 ? 15 : i < 72 ? 30 : i < 82 ? 500 : 20));
  return { closes, vols };
}

function drive(
  closes: number[],
  vols: number[],
  opts: {
    market?: 'SPOT' | 'USDT_M';
    startSide?: 'LONG' | 'SHORT' | 'FLAT';
    params?: Record<string, unknown>;
    calibration?: MacdEnergyCalibrationTable | null;
  } = {},
): { intents: TradeIntent[]; lastSide: string } {
  const s = createMacdEnergyReversalStrategy(opts.calibration ?? null);
  // 测试序列按 fast=5/slow=10/signal=3 设计（warmup 短、波形可预测）；默认 12/26/9 会改变 hist 结构
  const p = normalizeParams(s, { fast: 5, slow: 10, signal: 3, ...(opts.params ?? {}) });
  let side = opts.startSide ?? 'FLAT';
  const intents: TradeIntent[] = [];
  for (let i = 0; i < closes.length; i++) {
    const c: StrategyContext = {
      symbol: 'BTCUSDT', market: opts.market ?? 'USDT_M', interval: '1h',
      bars: closes.slice(0, i + 1).map((cl, k) => bar(cl, vols[k]!, k)),
      positionSide: side as 'LONG' | 'SHORT' | 'FLAT', positionQty: side === 'FLAT' ? 0 : 1,
      equity: 10000, cash: 10000, params: p, indicators: {},
    };
    const it = s.onBar(c, bar(closes[i]!, vols[i]!, i), i);
    if (it) {
      intents.push(it);
      if (it.action === 'OPEN_LONG') side = 'LONG';
      else if (it.action === 'OPEN_SHORT') side = 'SHORT';
      else if (it.action === 'CLOSE') side = 'FLAT';
    }
  }
  return { intents, lastSide: side };
}

const hasAction = (intents: TradeIntent[], action: TradeIntent['action']) => intents.some((i) => i.action === action);
const countAction = (intents: TradeIntent[], action: TradeIntent['action']) => intents.filter((i) => i.action === action).length;

registerBuiltinStrategies();

describe('macd_energy_reversal registry', () => {
  it('注册主 ID；兼容别名可创建但不重复展示', () => {
    const ids = builtinRegistry.list().map((m) => m.id);
    expect(ids).toContain('macd_energy_reversal');
    expect(ids).not.toContain('macd_energy'); // 别名为兼容 ID，隐藏不重复展示
    expect(builtinRegistry.has('macd_energy')).toBe(true);
    expect(builtinRegistry.create('macd_energy_reversal')).not.toBeNull();
    expect(builtinRegistry.create('macd_energy')).not.toBeNull();
  });

  it('别名工厂创建同一策略（id 为主 ID）', () => {
    const s = createMacdEnergyStrategy();
    expect(s.id).toBe('macd_energy_reversal');
    expect(s.name).toBe(createMacdEnergyReversalStrategy().name);
  });

  it('paramSpecs 默认值与 normalize 边界正确（文档 §6）', () => {
    const s = builtinRegistry.create('macd_energy_reversal')!;
    const d = defaultParams(s);
    expect(d['anchor']).toBe('volume');
    expect(d['priceRatio']).toBe(0.9);
    expect(d['volRatio']).toBe(0.8);
    expect(d['macdRatio']).toBe(0.2);
    expect(d['scoreMode']).toBe('saturating');
    expect(d['scoreIMax']).toBe(5.0);
    expect(d['scoreCap']).toBe(10);
    expect(d['scoreFilterMin']).toBe(0);
    expect(d['strictPeakDecay']).toBe(false);
    const p = normalizeParams(s, { macdRatio: 0, volRatio: 9, fast: 999, anchor: 'hist', scoreIMax: 0.5, scoreFilterMin: 99 });
    expect(p['macdRatio']).toBe(0.05); // clamp min
    expect(p['volRatio']).toBe(3.0); // clamp max
    expect(p['fast']).toBe(50); // clamp max
    expect(p['anchor']).toBe('hist');
    expect(p['scoreIMax']).toBe(1.1); // clamp min
    expect(p['scoreFilterMin']).toBe(10); // clamp max
  });
});

describe('scanZones 区段统计', () => {
  it('区段极值/价格 high-low/量峰处 hist 正确，进行中区段不返回', () => {
    // H: + + + - - （当前进行中的负区段不 flush）
    const H = [null, null, 1, 2, 3, -1, -2];
    const highs = [0, 0, 11, 15, 12, 10, 9];
    const lows = [0, 0, 9, 10, 8, 6, 5];
    const vols = [0, 0, 10, 20, 30, 40, 50];
    const zones = scanZones(H, highs, lows, vols, 6, 0);
    expect(zones.length).toBe(1);
    const z = zones[0]!;
    expect(z.sign).toBe(1);
    expect([z.start, z.end]).toEqual([2, 4]);
    expect(z.peak).toBe(3);
    expect(z.hv).toBe(3); // 量峰在 bar4（30），hist=3
    expect(z.vol).toBe(30);
    expect(z.ph).toBe(15);
    expect(z.pl).toBe(8);
  });

  it('volWindow>0 取量峰邻域均值并截断到区段内', () => {
    const H = [1, 1, 1, 1, -1];
    const highs = [1, 1, 1, 1, 1];
    const lows = [1, 1, 1, 1, 1];
    const vols = [100, 10, 20, 30, 40];
    const zones = scanZones(H, highs, lows, vols, 4, 2);
    // 正区段 [0..3]，量峰 bar0（100），邻域 ±2 截断到 [0..2] → (100+10+20)/3
    expect(zones[0]!.volPeakIdx).toBe(0);
    expect(zones[0]!.vol).toBeCloseTo(130 / 3, 6);
  });

  it('量峰并列取更靠近区段结束的 bar', () => {
    const H = [0.5, 0.4, 0.3, 0.2, -1];
    const highs = [1, 1, 1, 1, 1];
    const lows = [1, 1, 1, 1, 1];
    const vols = [100, 100, 100, 100, 5];
    const zones = scanZones(H, highs, lows, vols, 4, 0);
    expect(zones[0]!.volPeakIdx).toBe(3);
    expect(zones[0]!.hv).toBeCloseTo(0.2, 6);
  });
});

describe('detectSignal 三重比率确认与短路顺序', () => {
  const zp = zone(1, { peak: 1.0, hv: 1.0, vol: 10, ph: 100, pl: 90 });
  const zOk = zone(1, { peak: 0.15, hv: 0.15, vol: 100, ph: 95, pl: 80 });

  it('三项均满足 → 命中（trace 依次 price→vol→macd）', () => {
    const trace: string[] = [];
    const hit = detectSignal(zOk, zp, defaultDetect({ trace }));
    expect(hit).not.toBeNull();
    expect(hit!.dir).toBe('bear');
    expect(trace).toEqual(['price', 'vol', 'macd']);
  });

  it('价格确认失败 → 短路，不检查量与 MACD', () => {
    const trace: string[] = [];
    const hit = detectSignal(zone(1, { peak: 0.15, hv: 0.15, vol: 100, ph: 85, pl: 80 }), zp, defaultDetect({ trace }));
    expect(hit).toBeNull();
    expect(trace).toEqual(['price']);
  });

  it('量能确认失败 → 短路，不检查 MACD', () => {
    const trace: string[] = [];
    const hit = detectSignal(zone(1, { peak: 0.15, hv: 0.15, vol: 1, ph: 95, pl: 80 }), zp, defaultDetect({ trace }));
    expect(hit).toBeNull();
    expect(trace).toEqual(['price', 'vol']);
  });

  it('MACD 势能确认失败 → 不生成信号', () => {
    const trace: string[] = [];
    const hit = detectSignal(zone(1, { peak: 0.9, hv: 0.9, vol: 100, ph: 95, pl: 80 }), zp, defaultDetect({ trace }));
    expect(hit).toBeNull();
    expect(trace).toEqual(['price', 'vol', 'macd']);
  });

  it('看涨：负区段价格创新低被判为不成立（PL_B ≤ PL_A÷priceRatio）', () => {
    const zpn = zone(-1, { peak: -1.0, hv: -1.0, vol: 10, ph: 120, pl: 100 });
    const zBelow = zone(-1, { peak: -0.12, hv: -0.12, vol: 100, ph: 110, pl: 95 }); // 95 ≤ 100/0.9=111.1 ✓ 但价格更高 → 非新低
    expect(detectSignal(zBelow, zpn, defaultDetect())?.dir).toBe('bull');
    const zFail = zone(-1, { peak: -0.12, hv: -0.12, vol: 100, ph: 110, pl: 120 }); // 非新低区间
    expect(detectSignal(zFail, zpn, defaultDetect())).toBeNull();
  });

  it('minAbsEnergy：低于阈值不触发', () => {
    expect(detectSignal(zOk, zp, defaultDetect({ minAbsEnergy: 0.2 }))).toBeNull();
    expect(detectSignal(zOk, zp, defaultDetect({ minAbsEnergy: 0.1 }))).not.toBeNull();
  });

  it('strictPeakDecay：量峰处衰减但区段极值未衰减时不触发', () => {
    const zHighPeak = zone(1, { peak: 0.9, hv: 0.15, vol: 100, ph: 95, pl: 80 });
    expect(detectSignal(zHighPeak, zp, defaultDetect())).not.toBeNull();
    expect(detectSignal(zHighPeak, zp, defaultDetect({ strictPeakDecay: true }))).toBeNull();
  });

  it('除零边界：前量/前价缺失时对应达标倍数取 scoreCap 上限', () => {
    const zeroPrevVol = zone(1, { peak: 0.15, hv: 0.15, vol: 5, ph: 95, pl: 80 });
    const hitVol = detectSignal(zeroPrevVol, zone(1, { peak: 1, hv: 1, vol: 0, ph: 100, pl: 90 }), defaultDetect({ scoreCap: 4 }));
    expect(hitVol?.score.volMult).toBe(4);
    const zeroLow = zone(-1, { peak: -0.15, hv: -0.15, vol: 100, ph: 110, pl: 0 });
    const hitPrice = detectSignal(zeroLow, zone(-1, { peak: -1, hv: -1, vol: 10, ph: 120, pl: 90 }), defaultDetect({ scoreCap: 4 }));
    expect(hitPrice?.score.priceMult).toBe(4);
  });
});

describe('computeScore 强度评分（文档 §5.5 示例）', () => {
  const base = { priceRatio: 0.9, volRatio: 0.8, macdRatio: 0.2, scoreIMax: 5, scoreCap: 10 } as const;

  it('刚好满足三阈值 → I=1, Score=1', () => {
    const r = computeScore({ ...base, scoreMode: 'saturating', priceActualRatio: 0.9, volActualRatio: 0.8, macdActualRatio: 5 });
    expect(r.i).toBeCloseTo(1, 9);
    expect(r.score).toBeCloseTo(1, 9);
  });

  it('价格 1.2×前高：I=1.333, saturating=3.25, linear(5)=1.75', () => {
    const s = computeScore({ ...base, scoreMode: 'saturating', priceActualRatio: 1.2, volActualRatio: 0.8, macdActualRatio: 5 });
    expect(s.i).toBeCloseTo(1.333333, 5);
    expect(s.score).toBeCloseTo(3.25, 2);
    const lin = computeScore({ ...base, scoreMode: 'linear', priceActualRatio: 1.2, volActualRatio: 0.8, macdActualRatio: 5 });
    expect(lin.score).toBeCloseTo(1.75, 2);
  });

  it('量 2×前量：I=2.5, saturating=6.4, linear(5)=4.375', () => {
    const s = computeScore({ ...base, scoreMode: 'saturating', priceActualRatio: 0.9, volActualRatio: 2, macdActualRatio: 5 });
    expect(s.i).toBeCloseTo(2.5, 9);
    expect(s.score).toBeCloseTo(6.4, 6);
    const lin = computeScore({ ...base, scoreMode: 'linear', priceActualRatio: 0.9, volActualRatio: 2, macdActualRatio: 5 });
    expect(lin.score).toBeCloseTo(4.375, 6);
  });

  it('MACD 衰减到 0.05×前峰：I=4, saturating=7.75', () => {
    const r = computeScore({ ...base, scoreMode: 'saturating', priceActualRatio: 0.9, volActualRatio: 0.8, macdActualRatio: 20 });
    expect(r.i).toBeCloseTo(4, 9);
    expect(r.score).toBeCloseTo(7.75, 6);
  });

  it('三项均强：I=9, saturating=9.0, linear(5) 截断为 10', () => {
    const s = computeScore({ ...base, scoreMode: 'saturating', priceActualRatio: 1.35, volActualRatio: 1.6, macdActualRatio: 15 });
    expect(s.i).toBeCloseTo(9, 9);
    expect(s.score).toBeCloseTo(9, 6);
    const lin = computeScore({ ...base, scoreMode: 'linear', priceActualRatio: 1.35, volActualRatio: 1.6, macdActualRatio: 15 });
    expect(lin.score).toBeCloseTo(10, 6);
  });

  it('linear：I ≥ scoreIMax → Score=10；scoreIMax 越大评分越严', () => {
    const p = { ...base, priceActualRatio: 1.0, volActualRatio: 0.9, macdActualRatio: 5 }; // I≈1.11
    const loose = computeScore({ ...p, scoreMode: 'linear', scoreIMax: 1.5 });
    const tight = computeScore({ ...p, scoreMode: 'linear', scoreIMax: 5 });
    expect(loose.score).toBeGreaterThan(tight.score);
    expect(computeScore({ ...p, scoreMode: 'linear', scoreIMax: 1.1 }).score).toBeCloseTo(10, 6);
  });

  it('除零/极端值：价格与量取 scoreCap 上限', () => {
    const r = computeScore({ ...base, scoreMode: 'saturating', scoreCap: 3, priceActualRatio: 1e9, volActualRatio: 1e9, macdActualRatio: 5 });
    expect(r.priceMult).toBe(3);
    expect(r.volMult).toBe(3);
    expect(r.score).toBeLessThanOrEqual(10);
  });

  it('I<1（不合格）时 Score=0', () => {
    const r = computeScore({ ...base, scoreMode: 'saturating', priceActualRatio: 0.5, volActualRatio: 0.8, macdActualRatio: 5 });
    expect(r.score).toBe(0);
  });
});

describe('macd_energy_reversal 看跌信号（默认三重比率）', () => {
  it('both + USDT_M 空仓 → OPEN_SHORT，reason 含价格/量/势能/评分信息', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'USDT_M' });
    expect(hasAction(r.intents, 'OPEN_SHORT')).toBe(true);
    expect(r.lastSide).toBe('SHORT');
    const sh = r.intents.find((i) => i.action === 'OPEN_SHORT');
    expect(sh?.reason).toContain('看跌');
    expect(sh?.reason).toContain('priceMult=');
    expect(sh?.reason).toContain('I=');
    expect(sh?.reason).toContain('Score=');
    expect(sh?.reason).toContain('order=price>vol>macd');
  });

  it('价格确认失败（priceRatio 过大）→ 不触发', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { priceRatio: 0.99 } });
    expect(hasAction(r.intents, 'OPEN_SHORT')).toBe(false);
  });

  it('MACD 确认失败（macdRatio 过小）→ 不触发', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { macdRatio: 0.05 } });
    expect(hasAction(r.intents, 'OPEN_SHORT')).toBe(false);
  });

  it('anchor=hist + macdRatio=0.5 → 区段极值衰减触发', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { anchor: 'hist', macdRatio: 0.5 } });
    expect(hasAction(r.intents, 'OPEN_SHORT')).toBe(true);
  });

  it('SPOT 空仓：无法做空 → 无动作', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'SPOT' });
    expect(countAction(r.intents, 'OPEN_SHORT')).toBe(0);
  });

  it('SPOT 持多：看跌仅平多', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'SPOT', startSide: 'LONG' });
    expect(hasAction(r.intents, 'CLOSE')).toBe(true);
    expect(hasAction(r.intents, 'OPEN_SHORT')).toBe(false);
    expect(r.lastSide).toBe('FLAT');
  });

  it('反手：USDT_M 持多遇看跌 → OPEN_SHORT 全额转向', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'USDT_M', startSide: 'LONG' });
    const sh = r.intents.find((i) => i.action === 'OPEN_SHORT');
    expect(sh?.size).toBe(1);
    expect(r.lastSide).toBe('SHORT');
  });

  it('去重：同一区段对只触发一次', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'USDT_M' });
    expect(countAction(r.intents, 'OPEN_SHORT')).toBe(1);
  });

  it('volWindow=0 单根量同样满足确认', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { volWindow: 0 } });
    expect(hasAction(r.intents, 'OPEN_SHORT')).toBe(true);
  });

  it('minAbsEnergy 过滤：势能不足不触发，足够则触发', () => {
    const { closes, vols } = bearSeries();
    const blocked = drive(closes, vols, { market: 'USDT_M', params: { minAbsEnergy: 0.2 } }); // hv≈0.15 < 0.2
    expect(hasAction(blocked.intents, 'OPEN_SHORT')).toBe(false);
    const pass = drive(closes, vols, { market: 'USDT_M', params: { minAbsEnergy: 0.1 } });
    expect(hasAction(pass.intents, 'OPEN_SHORT')).toBe(true);
  });

  it('量峰并列：取更靠近区段结束的 bar（hv 取后者）', () => {
    const { closes, vols } = strictSeries();
    const vols2 = [...vols];
    vols2[71] = 500; // 陡涨段最后一根（hist 高）与横盘段并列
    const r = drive(closes, vols2, { market: 'USDT_M' });
    expect(hasAction(r.intents, 'OPEN_SHORT')).toBe(true);
  });
});

describe('macd_energy_reversal 看涨信号', () => {
  it('both + USDT_M 空仓 → OPEN_LONG', () => {
    const { closes, vols } = bullSeries();
    const r = drive(closes, vols, { market: 'USDT_M' });
    expect(hasAction(r.intents, 'OPEN_LONG')).toBe(true);
    expect(r.lastSide).toBe('LONG');
  });

  it('反手：持空遇看涨 → OPEN_LONG 全额转向', () => {
    const { closes, vols } = bullSeries();
    const r = drive(closes, vols, { market: 'USDT_M', startSide: 'SHORT' });
    const lg = r.intents.find((i) => i.action === 'OPEN_LONG');
    expect(lg?.size).toBe(1);
    expect(r.lastSide).toBe('LONG');
  });

  it('价格确认失败（PL_B 未达到前低比例）→ 不触发', () => {
    const { closes, vols } = bullSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { priceRatio: 0.99 } });
    expect(hasAction(r.intents, 'OPEN_LONG')).toBe(false);
  });
});

describe('macd_energy_reversal sideMode', () => {
  it('long：看跌仅平多，不反手；空仓无动作', () => {
    const { closes, vols } = bearSeries();
    const withPos = drive(closes, vols, { market: 'USDT_M', startSide: 'LONG', params: { sideMode: 'long' } });
    expect(hasAction(withPos.intents, 'CLOSE')).toBe(true);
    expect(hasAction(withPos.intents, 'OPEN_SHORT')).toBe(false);
    const flat = drive(closes, vols, { market: 'USDT_M', params: { sideMode: 'long' } });
    expect(flat.intents.length).toBe(0);
  });

  it('short：看涨仅平空；空仓看涨无动作；空仓看跌开空', () => {
    const { closes: bc, vols: bv } = bullSeries();
    const withPos = drive(bc, bv, { market: 'USDT_M', startSide: 'SHORT', params: { sideMode: 'short' } });
    expect(hasAction(withPos.intents, 'CLOSE')).toBe(true);
    expect(hasAction(withPos.intents, 'OPEN_LONG')).toBe(false);
    const flatBull = drive(bc, bv, { market: 'USDT_M', params: { sideMode: 'short' } });
    expect(flatBull.intents.length).toBe(0);
    const { closes: ac, vols: av } = bearSeries();
    const openShort = drive(ac, av, { market: 'USDT_M', params: { sideMode: 'short' } });
    expect(hasAction(openShort.intents, 'OPEN_SHORT')).toBe(true);
  });
});

describe('macd_energy_reversal 评分模式与过滤', () => {
  it('scoreMode=linear：reason 含 scoreMode/scoreIMax；scoreIMax 小 → 满分', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { scoreMode: 'linear', scoreIMax: 1.5 } });
    const sh = r.intents.find((i) => i.action === 'OPEN_SHORT');
    expect(sh?.reason).toContain('scoreMode=linear');
    expect(sh?.reason).toContain('scoreIMax=1.5');
    expect(sh?.reason).toContain('Score=10');
  });

  it('scoreFilterMin 过滤低分信号；阈值适中则放行', () => {
    const { closes, vols } = bearSeries();
    const blocked = drive(closes, vols, { market: 'USDT_M', params: { scoreFilterMin: 9.9 } });
    expect(hasAction(blocked.intents, 'OPEN_SHORT')).toBe(false);
    const pass = drive(closes, vols, { market: 'USDT_M', params: { scoreFilterMin: 1 } });
    expect(hasAction(pass.intents, 'OPEN_SHORT')).toBe(true);
  });

  it('scoreMode=calibrated：样本不足输出 null，不误用规则分', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { scoreMode: 'calibrated' } });
    const sh = r.intents.find((i) => i.action === 'OPEN_SHORT');
    expect(sh?.reason).toContain('scoreMode=calibrated');
    expect(sh?.reason).toContain('校准胜率=null');
  });

  it('scoreMode=calibrated：注入校准表后输出历史胜率与置信区间', () => {
    const samples = Array.from({ length: 40 }, () => ({ i: 16.8, score: 9.5, win: true, pnlPct: 0.02 }));
    const table = buildCalibrationTable(samples, { dimension: 'i', minSamples: 10, version: 'test-v1' });
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { scoreMode: 'calibrated', calibrationMinSamples: 10 }, calibration: table });
    const sh = r.intents.find((i) => i.action === 'OPEN_SHORT');
    expect(sh?.reason).toContain('校准胜率=1');
    expect(sh?.reason).toContain('样本=40');
    expect(sh?.reason).toContain('reliable=true');
  });
});

describe('macd_energy_reversal strictPeakDecay', () => {
  it('anchor=volume：默认（false）量峰处势能衰减即触发', () => {
    const { closes, vols } = strictSeries();
    const r = drive(closes, vols, { market: 'USDT_M' });
    expect(hasAction(r.intents, 'OPEN_SHORT')).toBe(true);
  });

  it('strictPeakDecay=true：新区段极值未衰减 → 不触发', () => {
    const { closes, vols } = strictSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { strictPeakDecay: true } });
    expect(hasAction(r.intents, 'OPEN_SHORT')).toBe(false);
  });
});

describe('macd_energy_reversal 止盈止损与趋势过滤', () => {
  const extend = (closes: number[], vols: number[], factor: number, n = 3) => {
    const c = [...closes];
    const v = [...vols];
    for (let i = 0; i < n; i++) c.push(c[c.length - 1]! * factor);
    for (let i = 0; i < n; i++) v.push(v[v.length - 1] ?? 50);
    return { closes: c, vols: v };
  };

  it('TP：开多后上涨达止盈比例 → CLOSE', () => {
    const { closes, vols } = extend(bullSeries().closes, bullSeries().vols, 1.04);
    const r = drive(closes, vols, { market: 'USDT_M' });
    expect(hasAction(r.intents, 'OPEN_LONG')).toBe(true);
    expect(r.intents.find((i) => i.action === 'CLOSE')?.reason).toContain('止盈');
  });

  it('SL：开多后下跌达止损比例 → CLOSE', () => {
    const { closes, vols } = extend(bullSeries().closes, bullSeries().vols, 0.97);
    const r = drive(closes, vols, { market: 'USDT_M' });
    expect(hasAction(r.intents, 'OPEN_LONG')).toBe(true);
    expect(r.intents.find((i) => i.action === 'CLOSE')?.reason).toContain('止损');
  });

  it('TP/SL 关闭（0）时持仓不因价格触发平仓', () => {
    const { closes, vols } = extend(bullSeries().closes, bullSeries().vols, 1.06);
    const r = drive(closes, vols, { market: 'USDT_M', params: { takeProfitPct: 0, stopLossPct: 0 } });
    expect(hasAction(r.intents, 'OPEN_LONG')).toBe(true);
    expect(hasAction(r.intents, 'CLOSE')).toBe(false);
  });

  it('trendFilter=zero：确认 bar 处 MACD 线仍在零轴下方 → 看涨信号被过滤', () => {
    const { closes, vols } = bullSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { trendFilter: 'zero' } });
    const off = drive(closes, vols, { market: 'USDT_M' });
    expect(hasAction(off.intents, 'OPEN_LONG')).toBe(true); // 关闭过滤时可触发
    expect(hasAction(r.intents, 'OPEN_LONG')).toBe(false); // zero 过滤拦截
  });

  it('trendFilter=ema 大周期（warmup 未完成）不拦截', () => {
    const { closes, vols } = bullSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { trendFilter: 'ema', trendEmaPeriod: 200 } });
    expect(hasAction(r.intents, 'OPEN_LONG')).toBe(true);
  });
});

describe('macd_energy_reversal 参数边界与 describe', () => {
  it('无效字符串参数回退默认行为', () => {
    const { closes, vols } = bearSeries();
    const r = drive(closes, vols, { market: 'USDT_M', params: { anchor: 'unknown', sideMode: 'unknown', scoreMode: 'unknown' } });
    expect(hasAction(r.intents, 'OPEN_SHORT')).toBe(true);
  });

  it('describe 说明完整（含三比率、短路顺序、评分模式）', () => {
    const s = createMacdEnergyReversalStrategy();
    const d = s.describe();
    expect(d).toContain('priceRatio');
    expect(d).toContain('volRatio');
    expect(d).toContain('macdRatio');
    expect(d).toContain('价格→成交量→MACD 势能');
    expect(d).toContain('scoreMode');
  });
});

describe('macdEnergyCalibration 校准模块', () => {
  it('wilsonInterval：样本为 0 返回 null，正常区间包含 p_hat', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const ci = wilsonInterval(6, 10)!;
    expect(ci.lower).toBeLessThan(0.6);
    expect(ci.upper).toBeGreaterThan(0.6);
    expect(ci.lower).toBeGreaterThanOrEqual(0);
    expect(ci.upper).toBeLessThanOrEqual(1);
  });

  it('isotonicRegression：输出按 x 单调不减', () => {
    const fitted = isotonicRegression([
      { x: 1, y: 0.2 }, { x: 2, y: 0.8 }, { x: 3, y: 0.3 }, { x: 4, y: 0.9 },
    ]);
    expect(fitted.length).toBe(4);
    for (let i = 1; i < fitted.length; i++) expect(fitted[i]!).toBeGreaterThanOrEqual(fitted[i - 1]!);
  });

  it('buildCalibrationTable：分桶样本数/胜率/Wilson 区间正确（method=bin）', () => {
    const samples = [
      { i: 1.05, score: 2, win: true },
      { i: 1.1, score: 2, win: false },
      { i: 2.5, score: 5, win: true },
      { i: 2.8, score: 6, win: true },
    ];
    const table = buildCalibrationTable(samples, { dimension: 'i', method: 'bin', minSamples: 1, version: 'v1' });
    const b1 = table.buckets.find((b) => b.lower === 1 && b.upper === 1.2)!;
    expect(b1.n).toBe(2);
    expect(b1.wins).toBe(1);
    expect(b1.winRate).toBeCloseTo(0.5, 9);
    expect(b1.ciLower).not.toBeNull();
    const b2 = table.buckets.find((b) => b.lower === 2 && b.upper === 3)!;
    expect(b2.n).toBe(2);
    expect(b2.winRate).toBeCloseTo(1, 9);
  });

  it('lookupCalibration：样本不足 → calibratedWinRate=null 且 reliable=false', () => {
    const table = buildCalibrationTable([{ i: 1.05, score: 1, win: true }], { dimension: 'i', method: 'bin', minSamples: 30 });
    const look = lookupCalibration(table, 1.05)!;
    expect(look.sampleSize).toBe(1);
    expect(look.calibratedWinRate).toBeNull();
    expect(look.reliable).toBe(false);
  });

  it('lookupCalibration：样本充足 → 输出校准胜率', () => {
    const samples = Array.from({ length: 50 }, (_, k) => ({ i: 1.05, score: 2, win: k < 40 }));
    const table = buildCalibrationTable(samples, { dimension: 'i', method: 'bin', minSamples: 30 });
    const look = lookupCalibration(table, 1.05)!;
    expect(look.calibratedWinRate).toBeCloseTo(0.8, 9);
    expect(look.reliable).toBe(true);
  });

  it('序列化/解析校准表可往返；非法 JSON 返回 null', () => {
    const table = buildCalibrationTable([{ i: 2.5, score: 5, win: true }], { dimension: 'i', method: 'isotonic' });
    const roundTrip = parseCalibrationTable(serializeCalibrationTable(table));
    expect(roundTrip?.buckets.length).toBe(table.buckets.length);
    expect(parseCalibrationTable('not json')).toBeNull();
    expect(parseCalibrationTable('{"buckets":[]}')).toBeNull();
  });
});
