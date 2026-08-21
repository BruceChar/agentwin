import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildApp, type AppHandle } from '../src/app.ts';

describe('AgentWin API', () => {
  let handle: AppHandle;

  beforeAll(async () => {
    process.env.AGENTWIN_USE_MOCK = '1';
    handle = await buildApp({
      host: '127.0.0.1', port: 0, dbEngine: 'sqlite', dbPath: ':memory:',
      llmProvider: 'deepseek', llmModel: 'deepseek-v4-flash',
      paperEnabled: true,
      paperInitialCapital: 10_000, paperTakerFeeRate: 0.001, paperSlippageBps: 2,
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it('health', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.storage).toBe('sqlite');
  });

  it('creates and lists accounts', async () => {
    const res = await handle.app.inject({
      method: 'POST', url: '/api/accounts',
      payload: { name: 'test-paper', type: 'paper', initialCapital: 5000 },
    });
    expect(res.statusCode).toBe(200);
    const list = await handle.app.inject({ method: 'GET', url: '/api/accounts' });
    const body = list.json();
    expect(body.accounts.length).toBeGreaterThanOrEqual(2);
    const created = body.accounts.find((a: { name: string }) => a.name === 'test-paper');
    expect(created).toBeTruthy();
    expect(created.balances[0].free).toBe(5000);
  });

  it('mock market klines', async () => {
    const res = await handle.app.inject({
      method: 'GET', url: '/api/market/klines?symbol=BTCUSDT&market=SPOT&interval=1h&limit=50',
    });
    expect(res.statusCode).toBe(200);
    const candles = res.json().candles;
    expect(candles.length).toBe(50);
  });

  it('runs backtest', async () => {
    const res = await handle.app.inject({
      method: 'POST', url: '/api/backtest',
      payload: { strategy: 'ma_cross', params: { fast: 5, slow: 20 }, symbol: 'BTCUSDT', market: 'SPOT', interval: '1h', fromDays: 30, initialCapital: 10000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics.totalTrades).toBeGreaterThan(0);
    expect(body.equityCurve.length).toBeGreaterThan(0);
  });

  it('saves strategies and lists builtins', async () => {
    const builtins = await handle.app.inject({ method: 'GET', url: '/api/strategies/builtin' });
    expect(builtins.json().strategies.length).toBeGreaterThanOrEqual(5);
    const res = await handle.app.inject({
      method: 'POST', url: '/api/strategies',
      payload: { name: 'rsi', params: { period: 10 }, symbol: 'BTCUSDT', market: 'SPOT', interval: '1h' },
    });
    expect(res.statusCode).toBe(200);
    const saved = res.json();
    expect(saved.id).toBeTruthy();
    const list = await handle.app.inject({ method: 'GET', url: '/api/strategies' });
    expect(list.json().strategies.length).toBeGreaterThanOrEqual(1);
  });

  it('starts and stops paper trading on mock data', async () => {
    const strat = await handle.app.inject({
      method: 'POST', url: '/api/strategies',
      payload: { name: 'ma_cross', params: { fast: 5, slow: 20 }, symbol: 'BTCUSDT', market: 'SPOT', interval: '1h' },
    });
    const cfg = strat.json();
    const start = await handle.app.inject({
      method: 'POST', url: '/api/paper/start',
      payload: { strategyId: 'ma_cross', configId: cfg.id, symbol: 'BTCUSDT', market: 'SPOT', interval: '1h' },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().running).toBe(true);
    // 等几根 mock K 线
    await new Promise((r) => setTimeout(r, 1200));
    const status = await handle.app.inject({ method: 'GET', url: '/api/paper/status' });
    expect(status.json().running).toBe(true);
    const stop = await handle.app.inject({ method: 'POST', url: '/api/paper/stop' });
    expect(stop.json().running).toBe(false);
    const pnl = await handle.app.inject({ method: 'GET', url: '/api/pnl' });
    expect(pnl.statusCode).toBe(200);
  });

  it('journal CRUD', async () => {
    const res = await handle.app.inject({
      method: 'POST', url: '/api/journal',
      payload: { kind: 'review', title: '复盘', body: '今天纪律不错', tags: ['btc'] },
    });
    expect(res.statusCode).toBe(200);
    const list = await handle.app.inject({ method: 'GET', url: '/api/journal' });
    expect(list.json().entries.length).toBeGreaterThanOrEqual(1);
  });
});
