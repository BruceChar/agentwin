import { describe, expect, it } from 'vitest';
import type { Candle, StrategyParamValue } from '@agentwin/shared';
import { defaultParams, normalizeParams, type StrategyContext, type TradeIntent } from '../src/strategy.ts';
import { builtinRegistry, type StrategyRegistry } from '../src/registry.ts';
import { registerBuiltinStrategies } from '../src/builtin/index.ts';

function bar(close: number, t: number): Candle {
  return { openTime: t, open: close - 1, high: close + 1, low: close - 1, close, volume: 1, closeTime: t + 1000, quoteVolume: 100, trades: 1, takerBuyBase: 0.5, takerBuyQuote: 50 };
}

function ctx(symbol = 'BTCUSDT', closes: number[], positionSide: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT', params: Record<string, StrategyParamValue> = {}): StrategyContext {
  return {
    symbol, market: 'SPOT', interval: '1h',
    bars: closes.map((c, i) => bar(c, i * 3_600_000)),
    positionSide, positionQty: positionSide === 'FLAT' ? 0 : 1,
    equity: 10000, cash: 10000, params,
    indicators: {},
  };
}

registerBuiltinStrategies();

describe('registry', () => {
  it('registers builtin strategies', () => {
    const list = builtinRegistry.list();
    expect(list.length).toBeGreaterThanOrEqual(5);
    const ids = list.map((m) => m.id);
    expect(ids).toContain('ma_cross');
    expect(ids).toContain('grid');
  });

  it('normalizeParams coerces and clamps', () => {
    const s = builtinRegistry.create('ma_cross')!;
    const p = normalizeParams(s, { fast: 999, slow: '20', unknown: 1 });
    expect(p['fast']).toBe(100); // clamp to max
    expect(p['slow']).toBe(20);
    expect(p['unknown']).toBeUndefined();
    expect(defaultParams(s)['sizePct']).toBe(0.95);
  });
});

describe('ma_cross', () => {
  it('opens long on crossover and closes on crossunder', () => {
    const s = builtinRegistry.create('ma_cross')!;
    const p = normalizeParams(s, { fast: 3, slow: 5, sizePct: 0.9 });
    // 构造：前面横盘，然后上涨
    const closes = [100, 100, 100, 100, 100, 101, 102, 103, 104, 105];
    const c = ctx('BTCUSDT', closes, 'FLAT', p);
    let intent: TradeIntent | null = null;
    for (let i = 4; i < closes.length; i++) {
      intent = s.onBar(c, bar(closes[i]!, i * 3_600_000), i);
      if (intent) break;
    }
    expect(intent?.action).toBe('OPEN_LONG');
    // 下跌后平仓
    const closes2 = [...closes, 104, 103, 102, 101, 100, 99, 98];
    const c2 = ctx('BTCUSDT', closes2, 'LONG', p);
    let exit: TradeIntent | null = null;
    for (let i = closes.length; i < closes2.length; i++) {
      exit = s.onBar(c2, bar(closes2[i]!, i * 3_600_000), i);
      if (exit) break;
    }
    expect(exit?.action).toBe('CLOSE');
  });
});

describe('rsi strategy', () => {
  it('opens long when oversold', () => {
    const s = builtinRegistry.create('rsi')!;
    const p = normalizeParams(s, { period: 5, oversold: 35, overbought: 65, sizePct: 0.9 });
    const closes = [100, 98, 96, 94, 92, 90, 88, 86]; // 持续下跌 → RSI 超卖
    const c = ctx('BTCUSDT', closes, 'FLAT', p);
    let intent: TradeIntent | null = null;
    for (let i = 5; i < closes.length; i++) {
      intent = s.onBar(c, bar(closes[i]!, i * 3_600_000), i);
      if (intent) break;
    }
    expect(intent?.action).toBe('OPEN_LONG');
  });
});

describe('grid strategy', () => {
  it('buys at grid level and sells at profit', () => {
    const s = builtinRegistry.create('grid')!;
    const p = normalizeParams(s, { gridPct: 2, sizePct: 0.2 });
    const c1 = ctx('BTCUSDT', [100], 'FLAT', p);
    const first = s.onBar(c1, bar(100, 0), 0);
    expect(first).toBeNull(); // 初始化
    const c2 = ctx('BTCUSDT', [100, 97.9], 'FLAT', p);
    const buy = s.onBar(c2, bar(97.9, 1), 1);
    expect(buy?.action).toBe('OPEN_LONG');
    const c3 = ctx('BTCUSDT', [97.9, 100.5], 'LONG', p);
    const sell = s.onBar(c3, bar(100.5, 2), 2);
    expect(sell?.action).toBe('CLOSE');
  });
});
