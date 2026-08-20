import { describe, expect, it } from 'vitest';
import { atr, bollinger, crossOver, crossUnder, ema, last, macd, rsi, sma, stdev } from '../src/indicators.ts';

describe('indicators', () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('sma warmup and values', () => {
    const s = sma(data, 3);
    expect(s[0]).toBeNull();
    expect(s[2]).toBe(2);
    expect(s[9]).toBe(9);
  });

  it('ema last value', () => {
    const e = ema(data, 3);
    expect(e[9]).toBeCloseTo(9.001953125, 5);
  });

  it('rsi bounded 0..100', () => {
    const r = rsi(data, 3);
    expect(r[9]).toBe(100); // 单调上涨
    const down = rsi(data.map((v) => 11 - v), 3);
    expect(down[9]).toBe(0);
  });

  it('macd shape', () => {
    const m = macd(data);
    expect(m.macd).toHaveLength(10);
    expect(m.signal).toHaveLength(10);
    expect(m.hist).toHaveLength(10);
  });

  it('atr positive', () => {
    const candles = data.map((v) => ({ high: v + 1, low: v - 1, close: v }));
    const a = atr(candles, 3);
    expect(a[9]).toBeGreaterThan(0);
  });

  it('bollinger mid equals sma', () => {
    const b = bollinger(data, 3, 2);
    expect(b.mid[9]).toBe(9);
    expect(b.upper[9]!).toBeGreaterThan(b.lower[9]!);
  });

  it('stdev', () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 5);
  });

  it('crossOver / crossUnder / last', () => {
    const fast = [1, 2, 3, 4, 5];
    const slow = [2, 2, 2, 2, 2];
    expect(crossOver(fast, slow, 1)).toBe(false); // 1<=2 且 2>2? no
    expect(crossOver(fast, slow, 2)).toBe(true);  // 2<=2 且 3>2
    expect(crossUnder(slow, fast, 2)).toBe(true); // 2>=2 且 2<3
    expect(last<number>([null, null, 42])).toBe(42);
  });
});
