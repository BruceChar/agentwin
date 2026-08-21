import { describe, expect, it } from 'vitest';
import {
  aggregateCandles,
  ema,
  fmtAxisTime,
  fmtPrice,
  fmtVol,
  macd,
  rsi,
  sma,
  volumeProfile,
  type CandleView,
} from './indicators.ts';

describe('indicators (web)', () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('sma 预热期与取值', () => {
    const s = sma(data, 5);
    expect(s[0]).toBeNull();
    expect(s[3]).toBeNull();
    expect(s[4]).toBe(3);
    expect(s[9]).toBe(8);
  });

  it('ema 以 SMA 为种子', () => {
    const e = ema(data, 5);
    expect(e[4]).toBe(3);
    expect(e[5]).toBe(4);
    expect(e[9]).toBe(8);
  });

  it('sma 支持小数周期（62.8 式）', () => {
    const s = sma(data, 3.5);
    expect(s[2]).toBeNull();
    // 窗口 = v0*0.5 + v1 + v2 + v3，除以 3.5
    expect(s[3]).toBeCloseTo(9.5 / 3.5, 9);
    expect(s[4]).toBeCloseTo(13 / 3.5, 9);
    // 整数周期行为不变
    expect(sma(data, 5)[4]).toBe(3);
    expect(sma(data, 5)[9]).toBe(8);
  });

  it('ema 支持小数周期（种子 = 小数 SMA）', () => {
    const e = ema(data, 3.5);
    expect(e[2]).toBeNull();
    expect(e[3]).toBeCloseTo(9.5 / 3.5, 9);
    const k = 2 / 4.5;
    expect(e[4]).toBeCloseTo((5 - e[3]!) * k + e[3]!, 9);
  });

  it('macd DIF=EMA12-EMA26，柱=2*(DIF-DEA)', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.3);
    const m = macd(closes);
    for (let i = 26; i < closes.length; i++) {
      const ef = ema(closes, 12)[i]!;
      const es = ema(closes, 26)[i]!;
      expect(m.dif[i]).toBeCloseTo(ef - es, 9);
    }
    expect(m.dif[10]).toBeNull();
    expect(m.hist[40]).not.toBeNull();
    expect(m.dea[40]).not.toBeNull();
  });

  it('rsi 单调涨=100 / 单调跌=0', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(up, 14)[14]).toBe(100);
    expect(rsi(up, 14)[29]).toBe(100);
    const down = Array.from({ length: 30 }, (_, i) => 300 - i);
    expect(rsi(down, 14)[29]).toBe(0);
    expect(rsi(up, 14)[13]).toBeNull();
  });

  it('volumeProfile 单根 K 线均摊到每个价格桶', () => {
    const c: CandleView = { openTime: 0, open: 5, high: 10, low: 0, close: 5, volume: 10 };
    const p = volumeProfile([c], 10);
    expect(p).toHaveLength(10);
    for (const b of p) expect(b.volume).toBeCloseTo(1, 9);
  });

  it('aggregateCandles 两两聚合 OHLCV 正确（2周）', () => {
    const w: CandleView[] = Array.from({ length: 4 }, (_, i) => ({
      openTime: i * 604_800_000, open: 10 + i, high: 20 + i, low: 5 + i, close: 12 + i, volume: 100 + i,
    }));
    const agg = aggregateCandles(w, 2);
    expect(agg).toHaveLength(2);
    expect(agg[0]).toMatchObject({ open: 10, high: 21, low: 5, close: 13, volume: 201 });
    expect(agg[1]).toMatchObject({ open: 12, high: 23, low: 7, close: 15, volume: 205 });
  });

  it('格式化函数', () => {
    // 本地时间构造（格式化按本地时区）
    expect(fmtAxisTime(new Date(2024, 0, 2, 3, 4, 5).getTime(), '1h')).toBe('03:04');
    expect(fmtAxisTime(new Date(2024, 0, 2, 3, 0, 0).getTime(), '4h')).toBe('01-02 03:00');
    expect(fmtAxisTime(new Date(2024, 0, 2, 0, 0, 0).getTime(), '1d')).toBe('01-02');
    expect(fmtAxisTime(new Date(2024, 0, 2, 0, 0, 0).getTime(), '1M')).toBe('2024-01');
    expect(fmtPrice(1234.5678)).toBe('1234.57');
    expect(fmtPrice(12.345678)).toBe('12.3457');
    expect(fmtVol(1_234_567)).toBe('1.23M');
    expect(fmtVol(999)).toBe('999.00');
  });
});
