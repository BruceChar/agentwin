import type { Candle, Interval, Market, SymbolInfo, Ticker } from '@agentwin/shared';
import { INTERVAL_MS } from '@agentwin/shared';
import type { KlineQuery, MarketDataProvider, MarketEvent, StreamSubscription, Unsubscribe } from './provider.ts';

export const MOCK_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

const BASE_PRICE: Record<string, number> = { BTCUSDT: 60000, ETHUSDT: 3000, SOLUSDT: 150 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

/** 确定性合成价格（按 seed 与 openTime 推导，回放一致） */
function synthPrice(symbol: string, timeMs: number, seed: number): number {
  const base = BASE_PRICE[symbol] ?? 100;
  const r = mulberry32(hashSeed(seed, symbol, Math.floor(timeMs / 3_600_000), 'price'));
  const wave = Math.sin(timeMs / 7_200_000) * 0.02 + Math.sin(timeMs / 1_800_000) * 0.005;
  const noise = (r() - 0.5) * 0.004;
  return base * (1 + wave + noise);
}

function synthFactor(symbol: string, openTime: number, seed: number, salt: string): number {
  const r = mulberry32(hashSeed(seed, symbol, openTime, salt));
  return r();
}

function makeCandle(symbol: string, openTime: number, step: number, seed: number): Candle {
  const open = synthPrice(symbol, openTime, seed);
  const close = synthPrice(symbol, openTime + step, seed);
  const high = Math.max(open, close) * (1 + synthFactor(symbol, openTime, seed, 'high') * 0.004);
  const low = Math.min(open, close) * (1 - synthFactor(symbol, openTime, seed, 'low') * 0.004);
  const volume = 10 + synthFactor(symbol, openTime, seed, 'vol') * 40;
  return {
    openTime, open, high, low, close, closeTime: openTime + step - 1, volume,
    quoteVolume: volume * (open + close) / 2,
    trades: Math.floor(20 + synthFactor(symbol, openTime, seed, 'trades') * 100),
    takerBuyBase: volume * synthFactor(symbol, openTime, seed, 'tb'),
    takerBuyQuote: volume * (open + close) / 2 * synthFactor(symbol, openTime, seed, 'tq'),
  };
}

/**
 * Mock 行情源：确定性合成 K 线（正弦 + 噪声），用于离线开发与测试。
 * 与真实 Binance 使用同一 MarketDataProvider 接口；同一查询永远返回同一结果。
 */
export class MockMarketData implements MarketDataProvider {
  readonly name = 'mock';
  private readonly seed: number;
  private timers: ReturnType<typeof setInterval>[] = [];
  private listeners = new Set<{ sub: StreamSubscription; cb: (e: MarketEvent) => void }>();

  constructor(seed = 42) {
    this.seed = seed;
  }

  async init(): Promise<void> {}
  async close(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.listeners.clear();
  }

  async getKlines(q: KlineQuery): Promise<Candle[]> {
    const step = INTERVAL_MS[q.interval];
    const end = q.endTime ?? Date.now();
    const start = q.startTime ?? end - (q.limit ?? 200) * step;
    const n = Math.min(q.limit ?? 200, Math.floor((end - start) / step));
    const out: Candle[] = [];
    for (let i = 0; i < n; i++) {
      out.push(makeCandle(q.symbol, start + i * step, step, this.seed));
    }
    return out;
  }

  async getTicker(symbol: string, market: Market): Promise<Ticker> {
    const close = synthPrice(symbol, Date.now(), this.seed);
    const r = mulberry32(hashSeed(this.seed, symbol, 'ticker'));
    return {
      symbol, market, lastPrice: close, priceChangePercent: (r() - 0.5) * 4,
      high24h: close * 1.02, low24h: close * 0.98, volume: 1000 + r() * 2000,
      quoteVolume: close * 2000, openPrice: close * 0.995, prevClosePrice: close * 0.99, closeTime: Date.now(),
    };
  }

  async getTickers(market: Market): Promise<Ticker[]> {
    return Promise.all(MOCK_SYMBOLS.map((s) => this.getTicker(s, market)));
  }

  async getSymbols(market: Market): Promise<SymbolInfo[]> {
    return MOCK_SYMBOLS.map((s) => ({
      symbol: s, baseAsset: s.replace('USDT', ''), quoteAsset: 'USDT', market,
      basePrecision: 6, quotePrecision: 2, pricePrecision: 2, minQty: 0.001, stepSize: 0.001, minNotional: 10, status: 'TRADING',
    }));
  }

  /** 模拟实时推送：定时推当前未收盘 K 线 */
  async subscribe(sub: StreamSubscription, cb: (e: MarketEvent) => void): Promise<Unsubscribe> {
    const entry = { sub, cb };
    this.listeners.add(entry);
    const step = sub.interval ? INTERVAL_MS[sub.interval] : 60_000;
    const timer = setInterval(() => {
      const now = Date.now();
      const openTime = Math.floor(now / step) * step;
      const candle = makeCandle(sub.symbol, openTime, step, this.seed);
      const ev: MarketEvent = { symbol: sub.symbol, market: sub.market, stream: 'kline', candle };
      if (sub.stream === 'kline') cb(ev);
      else if (sub.stream === 'bookTicker') cb({ ...ev, stream: 'bookTicker', bookTicker: { bidPrice: candle.close * 0.999, bidQty: 1, askPrice: candle.close * 1.001, askQty: 1 } });
    }, Math.max(200, Math.min(step, 5000)));
    this.timers.push(timer);
    return () => {
      clearInterval(timer);
      this.listeners.delete(entry);
    };
  }
}
