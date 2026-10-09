import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockMarketData } from '@agentwin/market';
import { registerBuiltinStrategies } from '@agentwin/strategy';
import type { StrategyRuntimeEvent } from '@agentwin/engine';
import { StrategyRuntimeManager } from '../src/strategy-runtime-manager.ts';
import type { AppServices } from '../src/services.ts';

describe('StrategyRuntimeManager', () => {
  const market = new MockMarketData();
  let manager: StrategyRuntimeManager;

  beforeAll(() => {
    registerBuiltinStrategies();
    // 仅使用 marketData，其余服务字段在该测试中不会触达
    const services = { marketData: market } as unknown as AppServices;
    manager = new StrategyRuntimeManager(services);
  });

  afterAll(async () => {
    await manager.closeAll();
    await market.close();
  });

  it('启动/停止运行时，广播事件并写入环形缓冲', async () => {
    const received: StrategyRuntimeEvent[] = [];
    const unsubscribe = manager.subscribe((e) => received.push(e));

    const status = await manager.start({
      strategyId: 'macd_energy_reversal', symbol: 'BTCUSDT', market: 'SPOT', interval: '1m',
      granularity: 'bar', params: { fast: 5, slow: 10, signal: 3 },
    });
    expect(status.running).toBe(true);
    expect(status.id).toBe('macd_energy_reversal:BTCUSDT:SPOT:1m');
    expect(status.granularity).toBe('bar');
    expect(status.throttleMs).toBe(3000);
    expect(status.bars).toBeGreaterThan(0);

    // 启动即广播 start + 首帧 indicator
    const types = received.map((e) => e.type);
    expect(types).toContain('start');
    expect(types).toContain('indicator');
    const indicator = received.find((e) => e.type === 'indicator');
    if (indicator && indicator.type === 'indicator') {
      expect(indicator.indicators.fast).toBe(5);
      expect(indicator.indicators.dif).not.toBeNull();
      expect(indicator.signal).toBeNull();
    }

    // 环形缓冲：可增量读取
    const all = manager.events({ runtimeId: status.id });
    expect(all.length).toBeGreaterThanOrEqual(2);
    const since = all[0]!.seq;
    const incremental = manager.events({ runtimeId: status.id, since });
    expect(incremental.every((e) => e.seq > since)).toBe(true);
    expect(manager.events({ runtimeId: status.id, since: all[all.length - 1]!.seq })).toHaveLength(0);

    // 单例状态
    expect(manager.list().map((r) => r.id)).toContain(status.id);
    await expect(manager.start({ strategyId: 'macd_energy_reversal', symbol: 'BTCUSDT', market: 'SPOT', interval: '1m' }))
      .rejects.toThrow(/already running/);

    const stopped = await manager.stop(status.id);
    expect(stopped?.running).toBe(false);
    expect(manager.list()).toHaveLength(0);
    expect(await manager.stop(status.id)).toBeNull();
    expect(manager.events({ runtimeId: status.id }).map((e) => e.type)).toContain('stop');
    unsubscribe();
  });

  it('未知策略在 start 时抛错且不留下运行时', async () => {
    await expect(manager.start({ strategyId: 'nope', symbol: 'BTCUSDT', market: 'SPOT', interval: '1m' }))
      .rejects.toThrow(/unknown strategy/);
    expect(manager.list()).toHaveLength(0);
  });
});
