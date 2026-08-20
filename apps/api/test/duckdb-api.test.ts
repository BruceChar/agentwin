import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildApp, type AppHandle } from '../src/app.ts';

describe('AgentWin API on DuckDB engine', () => {
  let handle: AppHandle;

  beforeAll(async () => {
    process.env.AGENTWIN_USE_MOCK = '1';
    handle = await buildApp({
      host: '127.0.0.1', port: 0, dbEngine: 'duckdb', dbPath: ':memory:',
      llmProvider: 'deepseek', llmModel: 'deepseek-v4-flash',
      paperInitialCapital: 10_000, paperTakerFeeRate: 0.001, paperSlippageBps: 2,
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it('health reports duckdb', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json().storage).toBe('duckdb');
  });

  it('runs backtest end-to-end on duckdb', async () => {
    const res = await handle.app.inject({
      method: 'POST', url: '/api/backtest',
      payload: { strategy: 'ma_cross', params: { fast: 5, slow: 20 }, symbol: 'BTCUSDT', market: 'SPOT', interval: '1h', fromDays: 30 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().metrics.totalTrades).toBeGreaterThan(0);
    // 回测结果持久化到 duckdb
    const list = await handle.app.inject({ method: 'GET', url: '/api/backtests' });
    expect(list.json().backtests.length).toBeGreaterThanOrEqual(1);
  });

  it('paper trading lifecycle on duckdb', async () => {
    const strat = await handle.app.inject({
      method: 'POST', url: '/api/strategies',
      payload: { name: 'rsi', params: { period: 10 }, symbol: 'BTCUSDT', market: 'SPOT', interval: '1h' },
    });
    const cfg = strat.json();
    const start = await handle.app.inject({
      method: 'POST', url: '/api/paper/start',
      payload: { strategyId: 'rsi', configId: cfg.id, symbol: 'BTCUSDT', market: 'SPOT', interval: '1h' },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().running).toBe(true);
    await new Promise((r) => setTimeout(r, 1000));
    const status = await handle.app.inject({ method: 'GET', url: '/api/paper/status' });
    expect(status.json().running).toBe(true);
    const stop = await handle.app.inject({ method: 'POST', url: '/api/paper/stop' });
    expect(stop.json().running).toBe(false);
  });
});
