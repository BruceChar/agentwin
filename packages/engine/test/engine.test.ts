import { describe, expect, it } from 'vitest';
import type { Candle, Interval, Market } from '@agentwin/shared';
import { createStorage } from '@agentwin/db';
import { MockMarketData } from '@agentwin/market';
import { registerBuiltinStrategies, builtinRegistry } from '@agentwin/strategy';
import { runBacktest } from '../src/backtest.ts';
import { PaperTradingEngine } from '../src/paper.ts';

registerBuiltinStrategies();

const INTERVAL = 3_600_000;

function candle(close: number, i: number): Candle {
  const t = 1_700_000_000_000 + i * INTERVAL;
  return {
    openTime: t, open: close * 0.99, high: close * 1.02, low: close * 0.98, close,
    volume: 100, closeTime: t + INTERVAL - 1, quoteVolume: close * 100,
    trades: 50, takerBuyBase: 50, takerBuyQuote: close * 50,
  };
}

/** 先跌后涨再跌的合成行情（保证均线交叉） */
function trendCandles(n = 200): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const pct = i < 60 ? 0.998 : (i < 160 ? 1.0025 : 0.997);
    const prev = out[i - 1]?.close ?? 100;
    out.push(candle(prev * pct, i));
  }
  return out;
}

describe('runBacktest', () => {
  it('runs ma_cross on trending data', async () => {
    const strategy = builtinRegistry.create('ma_cross')!;
    const result = await runBacktest({
      strategy,
      params: { fast: 5, slow: 20, sizePct: 0.95 },
      symbol: 'BTCUSDT', market: 'SPOT', interval: '1h',
      candles: trendCandles(),
      initialCapital: 10_000, feeRate: 0.001, slippageBps: 2,
    });
    expect(result.equityCurve.length).toBe(200);
    expect(result.metrics.totalTrades).toBeGreaterThan(0);
    expect(result.metrics.totalReturn).toBeGreaterThan(-1);
    expect(result.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.metrics.maxDrawdown).toBeLessThan(1);
    expect(result.trades[0]?.reason).toBeTruthy();
    expect(result.request.strategy?.parameters['fast']).toBe(5);
  });

  it('flat market yields few or zero trades and equity preserved', async () => {
    const strategy = builtinRegistry.create('ma_cross')!;
    const candles = Array.from({ length: 100 }, (_, i) => candle(100, i));
    const result = await runBacktest({
      strategy, params: { fast: 10, slow: 30 },
      symbol: 'BTCUSDT', market: 'SPOT', interval: '1h',
      candles, initialCapital: 10_000,
    });
    expect(result.metrics.finalEquity).toBeGreaterThan(0);
  });
});

describe('PaperTradingEngine', () => {
  it('processes closed bars and persists trades', async () => {
    const storage = createStorage({ engine: 'sqlite', path: ':memory:' });
    await storage.init();
    const acc = await storage.createAccount({ name: 'paper-test', type: 'paper' });
    await storage.setBalance(acc.id, 'USDT', 10_000);
    await storage.createStrategy({
      id: 'cfg-1', name: 'ma_cross', market: 'SPOT', symbol: 'BTCUSDT', interval: '1h',
      parameters: { fast: 5, slow: 20, sizePct: 0.9 }, source: 'user', enabled: true,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    const marketData = new MockMarketData(3);
    await marketData.init();
    const events: string[] = [];
    const engine = new PaperTradingEngine(
      { accountId: acc.id, strategyId: 'ma_cross', configId: 'cfg-1', market: 'SPOT', symbol: 'BTCUSDT', interval: '1h', initialCapital: 10_000 },
      { storage, marketData, strategyFactory: (id) => builtinRegistry.create(id), onEvent: (e) => events.push(e.type) },
    );

    // 直接喂已收盘 K 线（无需等待 WS）；120 根覆盖交叉点（bar 66 附近）
    const now = Date.now();
    const bars = trendCandles(120).map((b, i) => ({ ...b, openTime: now - (120 - i) * INTERVAL, closeTime: now - (120 - i) * INTERVAL + INTERVAL - 1 }));
    for (const b of bars) await engine.onKline(b);

    const trades = await storage.listTrades({ accountId: acc.id });
    const orders = await storage.listOrders({ accountId: acc.id });
    const eq = await storage.getEquityCurve(acc.id);
    expect(trades.length).toBeGreaterThan(0);
    expect(orders.length).toBe(trades.length);
    expect(eq.length).toBeGreaterThan(0);
    expect(events).toContain('trade');

    const status = engine.status();
    expect(status.running).toBe(false);
    expect(status.lastBarOpenTime).toBe(bars[bars.length - 1]!.openTime);
    await storage.close();
    await marketData.close();
  });
});
