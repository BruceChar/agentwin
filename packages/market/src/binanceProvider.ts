import type { Candle, Interval, Market, SymbolInfo, Ticker } from '@agentwin/shared';
import type { KlineQuery, MarketDataProvider, MarketEvent, PingResult, StreamSubscription, Unsubscribe } from './provider.ts';
import { BinanceRest, type RestOptions } from './binance/rest.ts';
import { BinanceWs, aggTradeStream, bookTickerStream, klineStream, markPriceStream } from './binance/ws.ts';
import type { RawWsAggTrade, RawWsBookTicker, RawWsKline, RawWsMarkPrice } from './binance/types.ts';

/** Binance 真实行情适配：REST（历史 K 线/行情）+ WebSocket（实时），多主机自动回退 */
export class BinanceMarketData implements MarketDataProvider {
  readonly name = 'binance';
  private rest: BinanceRest;
  private ws: BinanceWs;
  private subs = new Map<string, { sub: StreamSubscription; cb: (e: MarketEvent) => void; unsubscribe: Unsubscribe }>();

  constructor(opts: RestOptions = {}) {
    this.rest = new BinanceRest(opts);
    this.ws = new BinanceWs('SPOT', { onStatus: (s) => this.onWsStatus(s), baseUrl: opts.spotBaseUrl ?? process.env.BINANCE_WS_BASE_URL });
  }

  /** 连通性探测：选中一个可用主机即视为可达 */
  async ping(): Promise<PingResult> {
    try {
      const base = await this.rest.activeBase('SPOT');
      return { ok: true, host: base };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  private onWsStatus(_s: string): void {
    // 连接状态可上报到日志层；此处留空
  }

  async init(): Promise<void> {
    // 无需预连接；按需建立
  }

  async close(): Promise<void> {
    for (const { unsubscribe } of this.subs.values()) unsubscribe();
    this.subs.clear();
    this.ws.close();
  }

  async getKlines(q: KlineQuery): Promise<Candle[]> {
    return this.rest.klines(q.market, q.symbol, q.interval, { startTime: q.startTime, endTime: q.endTime, limit: q.limit });
  }

  async getTicker(symbol: string, market: Market): Promise<Ticker> {
    return this.rest.ticker(market, symbol);
  }

  async getTickers(market: Market): Promise<Ticker[]> {
    return this.rest.tickers(market);
  }

  async getSymbols(market: Market): Promise<SymbolInfo[]> {
    return this.rest.exchangeInfo(market);
  }

  async subscribe(sub: StreamSubscription, cb: (e: MarketEvent) => void): Promise<Unsubscribe> {
    const key = sub.symbol.toUpperCase() + ':' + sub.market + ':' + sub.stream + (sub.interval ? ':' + sub.interval : '');
    if (this.subs.has(key)) {
      const existing = this.subs.get(key)!;
      existing.cb = cb;
      return existing.unsubscribe;
    }
    const stream = this.wsStreamFor(sub);
    const handler = (raw: Record<string, unknown>) => {
      const ev = this.toEvent(sub, raw);
      if (ev) cb(ev);
    };
    const unsubscribe = this.ws.subscribe(stream, handler);
    this.subs.set(key, { sub, cb, unsubscribe });
    return () => {
      unsubscribe();
      this.subs.delete(key);
    };
  }

  private wsStreamFor(sub: StreamSubscription): string {
    switch (sub.stream) {
      case 'kline': return klineStream(sub.symbol, sub.interval ?? '1m');
      case 'aggTrade': return aggTradeStream(sub.symbol);
      case 'bookTicker': return bookTickerStream(sub.symbol);
      case 'markPrice': return markPriceStream(sub.symbol);
    }
  }

  private toEvent(sub: StreamSubscription, raw: Record<string, unknown>): MarketEvent | null {
    const base = { symbol: sub.symbol, market: sub.market, stream: sub.stream };
    switch (sub.stream) {
      case 'kline': {
        const k = raw['k'] as RawWsKline['k'];
        if (!k) return null;
        return { ...base, candle: {
          openTime: k.t, open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l),
          close: parseFloat(k.c), volume: parseFloat(k.v), closeTime: k.T,
          quoteVolume: parseFloat(k.q), trades: k.n, takerBuyBase: parseFloat(k.V), takerBuyQuote: parseFloat(k.Q),
        } };
      }
      case 'aggTrade': {
        const a = raw as unknown as RawWsAggTrade;
        return { ...base, aggTrade: { id: a.a, price: parseFloat(a.p), qty: parseFloat(a.q), time: a.T, isBuyerMaker: a.m } };
      }
      case 'bookTicker': {
        const b = raw as unknown as RawWsBookTicker;
        return { ...base, bookTicker: {
          bidPrice: parseFloat(b.b), bidQty: parseFloat(b.B), askPrice: parseFloat(b.a), askQty: parseFloat(b.A),
        } };
      }
      case 'markPrice': {
        const m = raw as unknown as RawWsMarkPrice;
        return { ...base, markPrice: { markPrice: parseFloat(m.p), indexPrice: parseFloat(m.i), fundingRate: parseFloat(m.r), nextFundingTime: m.T } };
      }
    }
  }
}
