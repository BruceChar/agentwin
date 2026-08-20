import { Spot } from '@binance/spot';
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures';
import type { Candle, Market, SymbolInfo, Ticker } from '@agentwin/shared';
import type { KlineQuery, MarketDataProvider, MarketEvent, PingResult, StreamSubscription, Unsubscribe } from './provider.ts';
import { BinanceWs, aggTradeStream, bookTickerStream, klineStream, markPriceStream } from './binance/ws.ts';
import { parseKlineRow, parseSymbolFilters } from './binance/rest.ts';
import { pickReachableBase, type HostOptions } from './binance/hosts.ts';
import { toMarketEvent } from './events.ts';
import type { RawKlineRow } from './binance/types.ts';

export interface OfficialProviderOptions extends HostOptions {
  apiKey?: string;
  apiSecret?: string;
  timeoutMs?: number;
  /** 注入 fetch（探测用），默认全局 fetch */
  fetchImpl?: typeof fetch;
}

type RowLike = (string | number)[];

/** 官方连接器 RestAPI 的宽松接口（仅声明我们用到的方法） */
interface LooseRestApi {
  klines(args: Record<string, unknown>): Promise<{ data: () => Promise<RowLike[]> }>;
  ticker24hr(args: Record<string, unknown>): Promise<{ data: () => Promise<unknown> }>;
  exchangeInfo(args?: Record<string, unknown>): Promise<{ data: () => Promise<{ symbols: Record<string, unknown>[] }> }>;
  klineCandlestickData(args: Record<string, unknown>): Promise<{ data: () => Promise<RowLike[]> }>;
  symbolPriceTicker(args?: Record<string, unknown>): Promise<{ data: () => Promise<unknown> }>;
  exchangeInformation(args?: Record<string, unknown>): Promise<{ data: () => Promise<{ symbols: Record<string, unknown>[] }> }>;
}

/**
 * 基于官方自动生成连接器（@binance/spot / @binance/derivatives-trading-usds-futures）的行情实现。
 * REST 走官方 SDK（basePath 支持多主机回退，如 data-api.binance.vision）；WebSocket 复用内置客户端。
 * 通过 createServices 的 BINANCE_PROVIDER=official 启用（默认 native：自研回退客户端）。
 */
export class BinanceOfficialMarketData implements MarketDataProvider {
  readonly name = 'binance-official';
  private readonly opts: OfficialProviderOptions;
  private spot: Spot | null = null;
  private futures: DerivativesTradingUsdsFutures | null = null;
  private baseCache = new Map<Market, { url: string; at: number }>();
  private ws = new BinanceWs('SPOT', {});
  private subHandlers = new Map<string, { cb: (e: MarketEvent) => void; unsubscribe: Unsubscribe }>();

  constructor(opts: OfficialProviderOptions = {}) {
    this.opts = opts;
  }

  private async pickBase(market: Market): Promise<string> {
    const cached = this.baseCache.get(market);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.url;
    const url = await pickReachableBase(market, this.opts, this.opts.fetchImpl);
    this.baseCache.set(market, { url, at: Date.now() });
    return url;
  }

  private async spotClient(): Promise<Spot> {
    if (this.spot) return this.spot;
    const base = await this.pickBase('SPOT');
    this.spot = new Spot({
      configurationRestAPI: {
        apiKey: this.opts.apiKey ?? '', apiSecret: this.opts.apiSecret,
        basePath: base, timeout: this.opts.timeoutMs ?? 15000,
      },
    });
    return this.spot;
  }

  private async futuresClient(): Promise<DerivativesTradingUsdsFutures> {
    if (this.futures) return this.futures;
    const base = await this.pickBase('USDT_M');
    this.futures = new DerivativesTradingUsdsFutures({
      configurationRestAPI: {
        apiKey: this.opts.apiKey ?? '', apiSecret: this.opts.apiSecret,
        basePath: base, timeout: this.opts.timeoutMs ?? 15000,
      },
    });
    return this.futures;
  }

  private loose(c: { restAPI: unknown }): LooseRestApi {
    return c.restAPI as LooseRestApi;
  }

  async init(): Promise<void> {
    // 连接按需建立
  }

  async close(): Promise<void> {
    for (const { unsubscribe } of this.subHandlers.values()) unsubscribe();
    this.subHandlers.clear();
    this.ws.close();
  }

  async ping(): Promise<PingResult> {
    try {
      const base = await this.pickBase('SPOT');
      return { ok: true, host: base };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async getKlines(q: KlineQuery): Promise<Candle[]> {
    const limit = q.limit ?? 200;
    const args: Record<string, unknown> = {
      symbol: q.symbol, interval: q.interval, limit,
      startTime: q.startTime, endTime: q.endTime,
    };
    const rows = q.market === 'SPOT'
      ? await (await this.loose(await this.spotClient()).klines(args)).data()
      : await (await this.loose(await this.futuresClient()).klineCandlestickData(args)).data();
    return rows.map((r) => parseKlineRow(r as unknown as RawKlineRow));
  }

  async getTicker(symbol: string, market: Market): Promise<Ticker> {
    if (market === 'SPOT') {
      const api = this.loose(await this.spotClient());
      const d = await (await api.ticker24hr({ symbol })).data();
      const item = firstItem(d);
      if (!item) throw new Error('no ticker for ' + symbol);
      return tickerFrom(item, market, symbol);
    }
    const api = this.loose(await this.futuresClient());
    const d = await (await api.symbolPriceTicker({ symbol })).data();
    const item = firstItem(d);
    if (!item) throw new Error('no ticker for ' + symbol);
    return {
      symbol, market, lastPrice: num(item['price']),
      priceChangePercent: 0, high24h: 0, low24h: 0, volume: 0, quoteVolume: 0,
      openPrice: 0, prevClosePrice: 0, closeTime: Date.now(),
    };
  }

  async getTickers(market: Market): Promise<Ticker[]> {
    if (market === 'SPOT') {
      const api = this.loose(await this.spotClient());
      const d = await (await api.ticker24hr({})).data();
      return normalizeArray(d).map((t) => tickerFrom(t as Record<string, unknown>, market, String((t as Record<string, unknown>)['symbol'])));
    }
    const api = this.loose(await this.futuresClient());
    const d = await (await api.symbolPriceTicker({})).data();
    return normalizeArray(d).map((t) => {
      const r = t as Record<string, unknown>;
      return {
        symbol: String(r['symbol']), market, lastPrice: num(r['price']),
        priceChangePercent: 0, high24h: 0, low24h: 0, volume: 0, quoteVolume: 0,
        openPrice: 0, prevClosePrice: 0, closeTime: Date.now(),
      };
    });
  }

  async getSymbols(market: Market): Promise<SymbolInfo[]> {
    const raw = market === 'SPOT'
      ? await (await this.loose(await this.spotClient()).exchangeInfo()).data()
      : await (await this.loose(await this.futuresClient()).exchangeInformation()).data();
    return (raw.symbols ?? [])
      .filter((s) => s['quoteAsset'] === 'USDT' && s['status'] === 'TRADING' && (market !== 'USDT_M' || s['contractType'] === 'PERPETUAL'))
      .map((s) => parseSymbolFilters(
        String(s['symbol']), market,
        (s['filters'] as { filterType: string }[]) ?? [],
        Number(s['quotePrecision'] ?? 2), Number(s['baseAssetPrecision'] ?? 8),
      ));
  }

  async subscribe(sub: StreamSubscription, cb: (e: MarketEvent) => void): Promise<Unsubscribe> {
    const key = sub.symbol.toUpperCase() + ':' + sub.market + ':' + sub.stream + (sub.interval ? ':' + sub.interval : '');
    const existing = this.subHandlers.get(key);
    if (existing) {
      existing.cb = cb;
      return existing.unsubscribe;
    }
    const stream = this.wsStreamFor(sub);
    const handler = (raw: Record<string, unknown>) => {
      const ev = toMarketEvent(sub, raw);
      if (ev) cb(ev);
    };
    const unsubscribe = this.ws.subscribe(stream, handler);
    this.subHandlers.set(key, { cb, unsubscribe });
    return () => {
      unsubscribe();
      this.subHandlers.delete(key);
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
}

function normalizeArray(d: unknown): unknown[] {
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    const r = (d as Record<string, unknown>)['result'];
    if (Array.isArray(r)) return r;
  }
  return [];
}

/** 取响应中的第一个对象：兼容数组 / { result: [...] } / 单对象三种形状 */
function firstItem(d: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(d)) return (d[0] ?? undefined) as Record<string, unknown> | undefined;
  if (d && typeof d === 'object') {
    const obj = d as Record<string, unknown>;
    if (Array.isArray(obj['result'])) return (obj['result'][0] ?? undefined) as Record<string, unknown> | undefined;
    if (obj['symbol'] !== undefined) return obj;
  }
  return undefined;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function tickerFrom(t: Record<string, unknown>, market: Market, symbol: string): Ticker {
  return {
    symbol, market,
    lastPrice: num(t['lastPrice']),
    priceChangePercent: num(t['priceChangePercent']),
    high24h: num(t['highPrice']), low24h: num(t['lowPrice']),
    volume: num(t['volume']), quoteVolume: num(t['quoteVolume']),
    openPrice: num(t['openPrice']), prevClosePrice: num(t['prevClosePrice']),
    closeTime: Number(t['closeTime'] ?? Date.now()),
  };
}
