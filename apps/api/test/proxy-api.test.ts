import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildApp, type AppHandle } from '../src/app.ts';

describe('runtime proxy endpoints', () => {
  let handle: AppHandle;

  beforeAll(async () => {
    process.env.AGENTWIN_USE_MOCK = '1';
    // 模拟已配置 Key：status.configured 应为 true（reachable 在沙箱中为 false）
    process.env.BINANCE_API_KEY = 'test-key';
    process.env.BINANCE_API_SECRET = 'test-secret';
    handle = await buildApp({
      host: '127.0.0.1', port: 0, dbEngine: 'sqlite', dbPath: ':memory:',
      llmProvider: 'deepseek', llmModel: 'deepseek-v4-flash',
      paperInitialCapital: 10_000, paperTakerFeeRate: 0.001, paperSlippageBps: 2,
    });
  });

  afterAll(async () => {
    await handle.close();
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_API_SECRET;
  });

  it('status reports configured when keys present', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/api/binance/status' });
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.proxy).toBeTruthy();
  });

  it('toggles proxy at runtime', async () => {
    const on = await handle.app.inject({
      method: 'POST', url: '/api/binance/proxy',
      payload: { mode: 'on', url: 'http://127.0.0.1:7890' },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().enabled).toBe(true);
    const get = await handle.app.inject({ method: 'GET', url: '/api/binance/proxy' });
    expect(get.json().url).toBe('http://127.0.0.1:7890');
    // 关闭
    const off = await handle.app.inject({
      method: 'POST', url: '/api/binance/proxy', payload: { mode: 'off' },
    });
    expect(off.json().enabled).toBe(false);
    // 非法 mode
    const bad = await handle.app.inject({
      method: 'POST', url: '/api/binance/proxy', payload: { mode: 'x' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
