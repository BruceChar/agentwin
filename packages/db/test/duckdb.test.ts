import { describe, expect, it } from 'vitest';
import type { Candle, CandleKey } from '@agentwin/shared';
import { createStorage } from '../src/index.ts';

function candle(key: Partial<CandleKey> & Pick<CandleKey, 'symbol' | 'market' | 'interval' | 'openTime'>): Candle & CandleKey {
  const t = key.openTime;
  return {
    openTime: t, open: 100, high: 110, low: 90, close: 105, volume: 10,
    closeTime: t + 60_000, quoteVolume: 1000, trades: 50, takerBuyBase: 5, takerBuyQuote: 500,
    symbol: key.symbol, market: key.market, interval: key.interval,
  };
}

describe('DuckdbStorage (adapter layer)', () => {
  it('migrates, accounts, balances, klines', async () => {
    const s = createStorage({ engine: 'duckdb', path: ':memory:' });
    await s.init();
    const acc = await s.createAccount({ name: 'paper-1', type: 'paper' });
    await s.setBalance(acc.id, 'USDT', 10000, 0);
    const bals = await s.getBalances(acc.id);
    expect(bals[0]?.free).toBe(10000);
    expect((await s.getAccount(acc.id))?.name).toBe('paper-1');

    const rows = [0, 1, 2, 3, 4].map((i) => candle({ symbol: 'BTCUSDT', market: 'SPOT', interval: '1h', openTime: 1_700_000_000_000 + i * 3_600_000 }));
    await s.upsertKlines(rows);
    await s.upsertKlines([{ ...rows[0]!, close: 106 }]); // upsert 更新
    const all = await s.getKlines({ symbol: 'BTCUSDT', market: 'SPOT', interval: '1h' });
    expect(all).toHaveLength(5);
    expect(all[0]?.close).toBe(106);
    const limited = await s.getKlines({ symbol: 'BTCUSDT', market: 'SPOT', interval: '1h', limit: 2 });
    expect(limited[0]?.openTime).toBe(1_700_000_000_000 + 3 * 3_600_000);
    expect(await s.countKlines('BTCUSDT', 'SPOT', '1h')).toBe(5);
    await s.close();
  });

  it('orders, trades, aggregates, positions', async () => {
    const s = createStorage({ engine: 'duckdb', path: ':memory:' });
    await s.init();
    const acc = await s.createAccount({ name: 'p', type: 'paper' });
    const o1 = await s.createOrder({ accountId: acc.id, symbol: 'BTCUSDT', market: 'SPOT', side: 'BUY', type: 'MARKET', quantity: 1 });
    await s.patchOrder(o1.id, { status: 'FILLED', filledQty: 1, avgFillPrice: 100, fee: 0.1, feeAsset: 'USDT' });
    await s.createTrade({ id: 't1', orderId: o1.id, accountId: acc.id, symbol: 'BTCUSDT', market: 'SPOT', side: 'BUY', qty: 1, price: 100, fee: 0.1, tradedAt: 1 });
    const o2 = await s.createOrder({ accountId: acc.id, symbol: 'BTCUSDT', market: 'SPOT', side: 'SELL', type: 'MARKET', quantity: 1 });
    await s.patchOrder(o2.id, { status: 'FILLED', filledQty: 1, avgFillPrice: 120, fee: 0.12, feeAsset: 'USDT' });
    await s.createTrade({ id: 't2', orderId: o2.id, accountId: acc.id, symbol: 'BTCUSDT', market: 'SPOT', side: 'SELL', qty: 1, price: 120, fee: 0.12, realizedPnl: 19.78, tradedAt: 2 });

    const agg = await s.tradeAggregates({ accountId: acc.id });
    expect(agg.totalTrades).toBe(2);
    expect(agg.wins).toBe(1);
    expect(agg.netPnl).toBeCloseTo(19.78, 5);

    await s.upsertPosition({ accountId: acc.id, symbol: 'BTCUSDT', market: 'SPOT', side: 'LONG', quantity: 1, avgEntryPrice: 100, unrealizedPnl: 5, realizedPnl: 0, updatedAt: 3 });
    expect((await s.getPositions(acc.id))[0]?.avgEntryPrice).toBe(100);
    await s.deletePosition(acc.id, 'BTCUSDT', 'SPOT');
    expect(await s.getPositions(acc.id)).toHaveLength(0);
    await s.close();
  });

  it('strategies, equity, llm, sentiment, backtest, journal', async () => {
    const s = createStorage({ engine: 'duckdb', path: ':memory:' });
    await s.init();
    const acc = await s.createAccount({ name: 'p', type: 'paper' });
    await s.createStrategy({ id: 's1', name: 'ma-cross', market: 'SPOT', symbol: 'BTCUSDT', interval: '1h', parameters: { fast: 5, slow: 20 }, source: 'user', enabled: true, createdAt: 1, updatedAt: 1 });
    expect((await s.getStrategy('s1'))?.parameters['fast']).toBe(5);
    await s.updateStrategy('s1', { enabled: false });
    expect((await s.getStrategy('s1'))?.enabled).toBe(false);

    await s.appendEquity({ accountId: acc.id, timestamp: 1, equity: 10000, cash: 10000, unrealizedPnl: 0 });
    await s.appendEquity({ accountId: acc.id, timestamp: 2, equity: 10100, cash: 9900, unrealizedPnl: 200 });
    expect(await s.getEquityCurve(acc.id)).toHaveLength(2);

    const sess = await s.createSession({ kind: 'strategy', title: 'ask' });
    await s.appendMessage({ sessionId: sess.id, role: 'user', content: 'hi' });
    await s.appendMessage({ sessionId: sess.id, role: 'assistant', content: 'hello' });
    expect((await s.listMessages(sess.id)).length).toBe(2);

    await s.upsertSentiment({ id: 'sen1', source: 'rss', symbol: 'BTCUSDT', headline: 'BTC rally', score: 0.8, label: 'bullish', keywords: ['rally'], createdAt: 1 });
    expect((await s.listSentiment({ symbol: 'BTCUSDT' }))[0]?.score).toBe(0.8);

    await s.saveBacktest({ strategyId: 's1', symbol: 'BTCUSDT', market: 'SPOT', interval: '1h', from: 1, to: 2, initialCapital: 10000, request: { a: 1 }, result: { b: 2 }, metrics: { c: 3 }, createdAt: 1 });
    expect((await s.listBacktests())[0]?.result).toEqual({ b: 2 });

    const j = await s.createJournalEntry({ accountId: acc.id, kind: 'review', title: '复盘', body: '内容', tags: ['btc'] });
    expect((await s.listJournalEntries({ accountId: acc.id }))[0]?.id).toBe(j.id);
    await s.close();
  });
});
