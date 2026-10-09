import { describe, expect, it } from 'vitest';
import type { Candle, Market, SymbolInfo, Ticker } from '@agentwin/shared';
import type { KlineQuery, MarketDataProvider, MarketEvent, StreamSubscription, Unsubscribe } from '@agentwin/market';
import type { Strategy, TradeIntent } from '@agentwin/strategy';
import { StrategyRuntime, defaultThrottleMs, type StrategyRuntimeEvent } from '../src/runtime.ts';

function candle(openTime: number, close: number, closeTime: number, volume = 10): Candle {
  return {
    openTime, open: close, high: close + 1, low: close - 1, close, volume,
    closeTime, quoteVolume: close * volume, trades: 1, takerBuyBase: volume / 2, takerBuyQuote: (close * volume) / 2,
  };
}

class FakeMarket implements MarketDataProvider {
  readonly name = 'fake';
  private cb: ((e: MarketEvent) => void) | null = null;
  unsubCalls = 0;
  private readonly warmup: Candle[];
  constructor(warmup: Candle[]) { this.warmup = warmup; }
  async init(): Promise<void> {}
  async close(): Promise<void> {}
  async ping(): Promise<{ ok: boolean }> { return { ok: true }; }
  async getKlines(_q: KlineQuery): Promise<Candle[]> { return this.warmup; }
  async getTicker(): Promise<Ticker> { throw new Error('not implemented'); }
  async getTickers(): Promise<Ticker[]> { return []; }
  async getSymbols(): Promise<SymbolInfo[]> { return []; }
  async subscribe(_sub: StreamSubscription, cb: (e: MarketEvent) => void): Promise<Unsubscribe> {
    this.cb = cb;
    return () => { this.unsubCalls++; this.cb = null; };
  }
  push(c: Candle, market: Market = 'USDT_M'): void {
    this.cb?.({ symbol: 'BTCUSDT', market, stream: 'kline', candle: c });
  }
}

function makeStrategy(onBar: (ctx: unknown, bar: Candle, index: number) => TradeIntent | null): Strategy {
  return {
    id: 'fake', name: 'fake', description: '',
    paramSpecs: [
      { name: 'fast', type: 'number', default: 5 },
      { name: 'slow', type: 'number', default: 10 },
      { name: 'signal', type: 'number', default: 3 },
    ],
    onBar: onBar as Strategy['onBar'],
    describe: () => 'fake',
  };
}

function make(warmup: Candle[], opts: { granularity?: 'bar' | 'intra'; throttleMs?: number; strategy?: Strategy; now?: () => number } = {}) {
  const market = new FakeMarket(warmup);
  const events: StrategyRuntimeEvent[] = [];
  const rt = new StrategyRuntime(
    {
      strategyId: 'fake', symbol: 'BTCUSDT', market: 'USDT_M', interval: '1m',
      granularity: opts.granularity, throttleMs: opts.throttleMs,
    },
    {
      marketData: market,
      strategyFactory: () => opts.strategy ?? makeStrategy(() => null),
      onEvent: (e) => events.push(e),
      now: opts.now,
    },
  );
  return { market, events, rt };
}

const types = (events: StrategyRuntimeEvent[]) => events.map((e) => e.type);

/** 生成 n 根连续 1m K 线（openTime 从 start 开始） */
function series(n: number, start = 0, p0 = 100): Candle[] {
  return Array.from({ length: n }, (_, i) => candle(start + i * 60_000, p0 + i, start + (i + 1) * 60_000 - 1));
}

describe('StrategyRuntime 粒度', () => {
  it('defaultThrottleMs 按周期推导并 clamp 到 1s–30s', () => {
    expect(defaultThrottleMs('1m')).toBe(3000);
    expect(defaultThrottleMs('15m')).toBe(30000);
    expect(defaultThrottleMs('1h')).toBe(30000);
    expect(defaultThrottleMs('1w')).toBe(30000);
  });
});

describe('StrategyRuntime 生命周期与事件', () => {
  it('start：预热 + start + 首帧 indicator；stop：退订 + stop 事件', async () => {
    const now = 10_000_000;
    const warmup = series(30);
    const { market, events, rt } = make(warmup, { now: () => now });
    await rt.start();
    expect(types(events)).toEqual(['start', 'indicator']);
    const first = events[1]!;
    expect(first.type).toBe('indicator');
    if (first.type === 'indicator') {
      expect(first.closed).toBe(true);
      expect(first.indicators.fast).toBe(5);
      expect(first.indicators.hist).not.toBeNull();
      expect(first.signal).toBeNull();
    }
    const st = rt.status();
    expect(st.running).toBe(true);
    expect(st.bars).toBe(30);
    expect(st.lastPrice).toBe(129);
    await rt.stop();
    expect(rt.status().running).toBe(false);
    expect(market.unsubCalls).toBe(1);
    expect(types(events)).toEqual(['start', 'indicator', 'stop']);
  });

  it('granularity=bar：未收盘不产生事件；收盘才发 candle + indicator（频率=周期）', async () => {
    const now = 1_000_000;
    const warmup = [candle(0, 100, 59_999), candle(60_000, 101, 119_999)];
    const { market, events, rt } = make(warmup, { granularity: 'bar', now: () => now });
    await rt.start();
    events.length = 0;

    market.push(candle(120_000, 105, now + 30_000)); // 未收盘：秒级推送不产生事件
    market.push(candle(120_000, 106, now + 30_000));
    expect(types(events)).toEqual([]);
    events.length = 0;

    market.push(candle(180_000, 106, now - 1)); // 已收盘
    expect(types(events)).toEqual(['candle', 'indicator']);
    const ind = events.find((e) => e.type === 'indicator');
    if (ind && ind.type === 'indicator') expect(ind.closed).toBe(true);
  });

  it('granularity=intra：盘中更新按 throttleMs 节流（未到点不发事件），收盘必更新', async () => {
    let now = 1_000_000;
    const warmup = [candle(0, 100, 59_999), candle(60_000, 101, 119_999)];
    const { market, events, rt } = make(warmup, { granularity: 'intra', throttleMs: 5000, now: () => now });
    await rt.start();
    events.length = 0;

    market.push(candle(120_000, 103, now + 60_000)); // 距 start 更新 0ms → 未到更新点
    market.push(candle(120_000, 104, now + 60_000)); // 仍节流
    expect(types(events)).toEqual([]);
    events.length = 0;

    now += 6000; // 超过 5s 节流
    market.push(candle(120_000, 105, now + 60_000));
    expect(types(events)).toEqual(['candle', 'indicator']);
    events.length = 0;

    market.push(candle(180_000, 106, now - 1)); // 收盘：即使未到节流也重算
    expect(types(events)).toEqual(['candle', 'indicator']);
    const ind = events.find((e) => e.type === 'indicator');
    if (ind && ind.type === 'indicator') expect(ind.closed).toBe(true);
  });

  it('策略信号透传到 indicator.signal', async () => {
    const warmup = [candle(0, 100, 59_999), candle(60_000, 101, 119_999)];
    const strategy = makeStrategy((_ctx, bar) => (bar.close > 101
      ? { action: 'OPEN_SHORT', sizeMode: 'pct', size: 0.9, reason: 'bear test' }
      : { action: 'FLAT', sizeMode: 'pct', size: 0, reason: 'none' }));
    const { market, events, rt } = make(warmup, { granularity: 'intra', throttleMs: 1, strategy });
    await rt.start();
    events.length = 0;
    market.push(candle(120_000, 200, Date.now() - 1));
    const ind = events.find((e) => e.type === 'indicator');
    expect(ind).toBeTruthy();
    if (ind && ind.type === 'indicator') {
      expect(ind.signal?.action).toBe('OPEN_SHORT');
      expect(ind.signal?.reason).toBe('bear test');
    }
  });

  it('策略抛错：发出 error 事件且运行时保持运行', async () => {
    const warmup = [candle(0, 100, 59_999)];
    const strategy = makeStrategy(() => { throw new Error('boom'); });
    const { events, rt } = make(warmup, { strategy, now: () => 1_000_000 });
    await rt.start();
    expect(types(events)).toContain('error');
    expect(rt.status().running).toBe(true);
    await rt.stop();
  });

  it('未知策略抛错', () => {
    expect(() => new StrategyRuntime(
      { strategyId: 'nope', symbol: 'BTCUSDT', market: 'USDT_M', interval: '1h' },
      { marketData: new FakeMarket([]), strategyFactory: () => null },
    )).toThrow(/unknown strategy/);
  });
});
