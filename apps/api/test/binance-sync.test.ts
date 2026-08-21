import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createStorage } from '@agentwin/db';
import { MockMarketData } from '@agentwin/market';
import type { BinanceRest } from '@agentwin/market';
import { BinanceAccountSync } from '../src/binance-sync.ts';

function makeFakeRest() {
  return {
    serverTime: async () => Date.now(),
    reachable: async () => true,
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
    marginAccount: async () => ({
      totalNetAssetOfQuoteAsset: 800,
      assets: [{ asset: 'USDT', free: 800, locked: 0, netAsset: 800 }],
    }),
    marginIsolatedAccount: async () => ([
      { symbol: 'ETHUSDT', baseAsset: { asset: 'ETH', free: 0.5, locked: 0, netAsset: 0.5 }, quoteAsset: { asset: 'USDT', free: 100, locked: 0, netAsset: 100 } },
    ]),
    coinmAccount: async () => ({
      assets: [{ asset: 'BTC', walletBalance: 0.05, unrealizedProfit: 0, availableBalance: 0.05 }],
      positions: [{ symbol: 'BTCUSD_PERP', positionAmt: 0.01, entryPrice: 60000, markPrice: 61000, unrealizedProfit: 10, realizedProfit: 5 }],
      totalWalletBalance: 0.05, totalUnrealizedProfit: 10,
    }),
    myTrades: async (market: string, symbol: string) => {
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
      if (market === 'MARGIN' && symbol === 'BTCUSDT') {
        return [
          { id: 31, orderId: 301, symbol, side: 'BUY', price: 69000, qty: 0.3, commission: 20.7, commissionAsset: 'USDT', time: 1700000400000 },
        ];
      }
      if (market === 'MARGIN_ISOLATED' && symbol === 'ETHUSDT') {
        return [
          { id: 41, orderId: 401, symbol, side: 'BUY', price: 2000, qty: 0.5, commission: 1, commissionAsset: 'USDT', time: 1700000500000 },
        ];
      }
      if (market === 'COIN_M' && symbol === 'BTCUSD_PERP') {
        return [
          { id: 51, orderId: 501, symbol, side: 'BUY', price: 60000, qty: 0.01, commission: 0.6, commissionAsset: 'BTC', time: 1700000600000, realizedPnl: '5', positionSide: 'LONG' },
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

  it('syncs balances, futures positions and trades into local storage (all markets)', async () => {
    const report = await sync.syncAll();
    expect(report.ok).toBe(true);
    expect(report.balancesUpserted).toBeGreaterThanOrEqual(5);
    expect(report.futuresPositions).toBe(3); // U本位 1 + 逐仓杠杆 1 + 币本位 1
    expect(report.tradesSynced).toBe(7); // 现货2 + U本位2 + 全仓1 + 逐仓1 + 币本位1

    const acc = (await storage.listAccounts()).find((a) => a.type === 'real')!;
    expect(acc.name).toBe('binance-real');

    const balances = await storage.getBalances(acc.id);
    const spotUsdt = balances.find((b) => b.asset === 'USDT' && b.market === 'SPOT')!;
    expect(spotUsdt.free).toBe(5000);
    expect(spotUsdt.locked).toBe(100);
    const futuresUsdt = balances.find((b) => b.asset === 'USDT' && b.market === 'USDT_M')!;
    expect(futuresUsdt.free).toBe(2000);
    const marginUsdt = balances.find((b) => b.asset === 'USDT' && b.market === 'MARGIN')!;
    expect(marginUsdt.free).toBe(800);
    const coinmBtc = balances.find((b) => b.asset === 'BTC' && b.market === 'COIN_M')!;
    expect(coinmBtc.free).toBe(0.05);

    const positions = await storage.getPositions(acc.id);
    expect(positions[0]?.symbol).toBe('BTCUSDT');
    expect(positions[0]?.side).toBe('LONG');
    expect(positions[0]?.quantity).toBe(0.1);

    const trades = await storage.listTrades({ accountId: acc.id });
    expect(trades.length).toBe(7);
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
    expect(r1.tradesSynced).toBe(7);
    expect(r2.tradesSynced).toBe(0);
    expect(r2.tradesSkipped).toBe(7);
    const acc = (await storage.listAccounts()).find((a) => a.type === 'real')!;
    expect((await storage.listTrades({ accountId: acc.id })).length).toBe(7);
  });

  it('reports missing secret clearly', async () => {
    const prevKey = process.env.BINANCE_API_KEY;
    const prevSecret = process.env.BINANCE_API_SECRET;
    process.env.BINANCE_API_KEY = 'k-only';
    delete process.env.BINANCE_API_SECRET;
    const st = await sync.status();
    expect(st.configured).toBe(false);
    expect(st.hasKey).toBe(true);
    expect(st.hasSecret).toBe(false);
    expect(st.missing).toContain('BINANCE_API_SECRET');
    if (prevKey === undefined) delete process.env.BINANCE_API_KEY; else process.env.BINANCE_API_KEY = prevKey;
    if (prevSecret === undefined) delete process.env.BINANCE_API_SECRET; else process.env.BINANCE_API_SECRET = prevSecret;
  });

  it('records last sync result (incl. failure reason)', async () => {
    const failingRest = { ...makeFakeRest(), spotAccount: async () => { throw new Error('network down'); } } as unknown as BinanceRest;
    const sync2 = new BinanceAccountSync(storage, failingRest, marketData);
    const report = await sync2.syncAll();
    expect(report.ok).toBe(false);
    const st = await sync2.status();
    expect(st.lastSync?.ok).toBe(false);
    expect(st.lastSync?.message).toContain('network down');
    expect(st.lastSync?.at).toBeGreaterThan(0);
  });

  it('status reports configured + reachable with keys', async () => {
    const prevKey = process.env.BINANCE_API_KEY;
    const prevSecret = process.env.BINANCE_API_SECRET;
    process.env.BINANCE_API_KEY = 'k';
    process.env.BINANCE_API_SECRET = 's';
    const st = await sync.status();
    expect(st.configured).toBe(true);
    expect(st.hasKey).toBe(true);
    expect(st.hasSecret).toBe(true);
    expect(st.missing).toEqual([]);
    expect(st.reachable).toBe(true);
    if (prevKey === undefined) delete process.env.BINANCE_API_KEY; else process.env.BINANCE_API_KEY = prevKey;
    if (prevSecret === undefined) delete process.env.BINANCE_API_SECRET; else process.env.BINANCE_API_SECRET = prevSecret;
  });
});
