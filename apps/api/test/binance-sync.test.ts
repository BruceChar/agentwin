import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createStorage } from '@agentwin/db';
import { MockMarketData } from '@agentwin/market';
import type { BinanceRest } from '@agentwin/market';
import { BinanceAccountSync } from '../src/binance-sync.ts';

function makeFakeRest() {
  return {
    serverTime: async () => Date.now(),
    spotAccount: async () => ({
      balances: [
        { asset: 'USDT', free: 5000, locked: 100 },
        { asset: 'BTC', free: 0.5, locked: 0 },
      ],
    }),
    futuresAccount: async () => ({
      balances: [{ asset: 'USDT', walletBalance: 2000, availableBalance: 1800 }],
      positions: [{ symbol: 'BTCUSDT', positionSide: 'LONG', positionAmt: 0.1, entryPrice: 70000, markPrice: 71000, unrealizedProfit: 100, realizedProfit: 50 }],
      totalWalletBalance: 2000, totalUnrealizedProfit: 100, totalMarginBalance: 2100,
    }),
    myTrades: async (market: 'SPOT' | 'USDT_M', symbol: string) => {
      if (market === 'SPOT' && symbol === 'BTCUSDT') {
        return [
          { id: 11, orderId: 101, symbol, side: 'BUY', price: 69000, qty: 0.2, commission: 13.8, commissionAsset: 'USDT', time: 1700000000000 },
          { id: 12, orderId: 102, symbol, side: 'SELL', price: 71000, qty: 0.2, commission: 14.2, commissionAsset: 'USDT', time: 1700000100000 },
        ];
      }
      if (market === 'USDT_M' && symbol === 'BTCUSDT') {
        return [
          { id: 21, orderId: 201, symbol, side: 'BUY', price: 69000, qty: 0.1, commission: 0.69, commissionAsset: 'USDT', time: 1700000200000, realizedPnl: '0', positionSide: 'LONG' },
          { id: 22, orderId: 202, symbol, side: 'SELL', price: 70000, qty: 0.1, commission: 0.7, commissionAsset: 'USDT', time: 1700000300000, realizedPnl: '99.39', positionSide: 'LONG' },
        ];
      }
      return [];
    },
  } as unknown as BinanceRest;
}

describe('BinanceAccountSync', () => {
  let storage: ReturnType<typeof createStorage>;
  let marketData: MockMarketData;
  let sync: BinanceAccountSync;

  beforeEach(async () => {
    storage = createStorage({ engine: 'sqlite', path: ':memory:' });
    await storage.init();
    marketData = new MockMarketData(1);
    await marketData.init();
    sync = new BinanceAccountSync(storage, makeFakeRest(), marketData);
  });

  afterEach(async () => {
    await storage.close();
    await marketData.close();
  });

  it('syncs balances, futures positions and trades into local storage', async () => {
    const report = await sync.syncAll();
    expect(report.ok).toBe(true);
    expect(report.balancesUpserted).toBeGreaterThanOrEqual(2);
    expect(report.futuresPositions).toBe(1);
    expect(report.tradesSynced).toBe(4); // 现货 2 + 合约 2

    const acc = (await storage.listAccounts()).find((a) => a.type === 'real')!;
    expect(acc.name).toBe('binance-real');

    const balances = await storage.getBalances(acc.id);
    const usdt = balances.find((b) => b.asset === 'USDT')!;
    expect(usdt.free).toBe(7000); // 现货 5000 + 合约钱包 2000（合并展示）
    expect(usdt.locked).toBe(100);

    const positions = await storage.getPositions(acc.id);
    expect(positions[0]?.symbol).toBe('BTCUSDT');
    expect(positions[0]?.side).toBe('LONG');
    expect(positions[0]?.quantity).toBe(0.1);

    const trades = await storage.listTrades({ accountId: acc.id });
    expect(trades.length).toBe(4);
    const futuresSell = trades.find((t) => t.id === 'real-BTCUSDT-USDT_M-22')!;
    expect(futuresSell.realizedPnl).toBeCloseTo(99.39, 2);
    expect(futuresSell.meta?.['positionSide']).toBe('LONG');
    const spotBuy = trades.find((t) => t.id === 'real-BTCUSDT-SPOT-11')!;
    expect(spotBuy.realizedPnl).toBeUndefined();

    const curve = await storage.getEquityCurve(acc.id);
    expect(curve.length).toBeGreaterThan(0);
    expect(curve[0]!.equity).toBeGreaterThan(5000); // USDT + BTC×价 + 合约
  });

  it('is idempotent: second sync skips existing trades', async () => {
    const r1 = await sync.syncAll();
    const r2 = await sync.syncAll();
    expect(r1.tradesSynced).toBe(4);
    expect(r2.tradesSynced).toBe(0);
    expect(r2.tradesSkipped).toBe(4);
    const acc = (await storage.listAccounts()).find((a) => a.type === 'real')!;
    expect((await storage.listTrades({ accountId: acc.id })).length).toBe(4);
  });

  it('status reports configured + reachable with keys', async () => {
    const prevKey = process.env.BINANCE_API_KEY;
    const prevSecret = process.env.BINANCE_API_SECRET;
    process.env.BINANCE_API_KEY = 'k';
    process.env.BINANCE_API_SECRET = 's';
    const st = await sync.status();
    expect(st.configured).toBe(true);
    expect(st.reachable).toBe(true);
    if (prevKey === undefined) delete process.env.BINANCE_API_KEY; else process.env.BINANCE_API_KEY = prevKey;
    if (prevSecret === undefined) delete process.env.BINANCE_API_SECRET; else process.env.BINANCE_API_SECRET = prevSecret;
  });
});
