import type { AggTrade, Candle, Interval, Market, MarkPrice, SymbolInfo, Ticker } from '@agentwin/shared';
import { buildQueryString, buildSignedQuery } from './sign.ts';
import type { RawAggTrade, RawExchangeInfo, RawKlineRow, RawMarkPrice, RawSymbolFilter, RawTicker } from './types.ts';
import { FUTURES_BASE, SPOT_BASE, SPOT_TESTNET_BASE, pickReachableBase, probeBase, type HostOptions } from './hosts.ts';

// 常量与错误类型由 hosts.ts 提供，这里统一再导出（兼容既有引用）
export { SPOT_BASE, SPOT_TESTNET_BASE, SPOT_DATA_API_BASE, FUTURES_BASE, MarketDataUnavailableError, restCandidatesFor } from './hosts.ts';

export interface RestOptions extends HostOptions {
  apiKey?: string;
  apiSecret?: string;
  timeoutMs?: number;
  /** 注入 fetch（测试用），默认全局 fetch */
  fetchImpl?: typeof fetch;
}

/** 从 exchangeInfo 过滤器解析精度信息 */
export function parseSymbolFilters(symbol: string, market: Market, filters: RawSymbolFilter[], quotePrecision: number, baseAssetPrecision: number): SymbolInfo {
  let minQty = 0, stepSize = 0, minNotional = 0, tickSize = 0;
  for (const f of filters) {
    if (f.filterType === 'LOT_SIZE') {
      minQty = parseFloat(f.minQty ?? '0');
      stepSize = parseFloat(f.stepSize ?? '0');
    } else if (f.filterType === 'NOTIONAL') {
      minNotional = parseFloat(f.minNotional ?? '0');
    } else if (f.filterType === 'PRICE_FILTER') {
      tickSize = parseFloat(f.tickSize ?? '0');
    }
  }
  const pricePrecision = tickSize > 0 ? Math.max(0, -Math.floor(Math.log10(tickSize) + 1e-9)) : quotePrecision;
  return {
    symbol, baseAsset: symbol.replace(/USDT$/, ''), quoteAsset: 'USDT', market,
    basePrecision: baseAssetPrecision, quotePrecision,
    pricePrecision, minQty, stepSize, minNotional, status: 'TRADING',
  };
}

export function parseKlineRow(row: RawKlineRow): Candle {
  return {
    openTime: row[0], open: parseFloat(row[1]), high: parseFloat(row[2]), low: parseFloat(row[3]),
    close: parseFloat(row[4]), volume: parseFloat(row[5]), closeTime: row[6],
    quoteVolume: parseFloat(row[7]), trades: row[8], takerBuyBase: parseFloat(row[9]), takerBuyQuote: parseFloat(row[10]),
  };
}

/**
 * Binance REST 客户端（现货 + USDT-M 合约）。
 * 公开行情接口无需鉴权；私有接口（账户只读）需要 apiKey/apiSecret。
 */
export class BinanceRest {
  private readonly opts: RestOptions;
  private readonly fetchImpl: typeof fetch;
  /** market -> 已选中的可用 base（带时间戳缓存） */
  private baseCache = new Map<Market, { url: string; at: number }>();

  constructor(opts: RestOptions = {}) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** 选择可用主机（缓存 5 分钟；失败自动重探） */
  private async pickBase(market: Market): Promise<string> {
    const cached = this.baseCache.get(market);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.url;
    const url = await pickReachableBase(market, this.opts, this.fetchImpl);
    this.baseCache.set(market, { url, at: Date.now() });
    return url;
  }

  private async request<T>(market: Market, method: string, path: string, params: Record<string, string | number | boolean | undefined> = {}, signed = false): Promise<T> {
    // 签名请求必须走官方主端点（key 只在该域名有效）
    const base = signed
      ? (market === 'SPOT' ? (this.opts.testnet ? SPOT_TESTNET_BASE : SPOT_BASE) : FUTURES_BASE)
      : await this.pickBase(market);
    let url = base + path;
    const headers: Record<string, string> = {};
    if (signed) {
      if (!this.opts.apiKey || !this.opts.apiSecret) throw new Error('BinanceRest: apiKey/apiSecret required for signed request');
      const ts = Date.now();
      const qs = buildSignedQuery(params, this.opts.apiSecret, ts);
      url += '?' + qs;
      headers['X-MBX-APIKEY'] = this.opts.apiKey;
    } else {
      const qs = buildQueryString(params);
      if (qs) url += '?' + qs;
    }
    const timeoutMs = this.opts.timeoutMs ?? 15000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(url, { method, headers, signal: ctrl.signal });
      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch { /* ignore */ }
        throw new Error(`Binance ${market} ${method} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (e) {
      // 非签名请求失败：清空缓存，下次调用自动重探其他主机
      if (!signed) this.baseCache.delete(market);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async ping(market: Market): Promise<void> {
    await this.request(market, 'GET', market === 'SPOT' ? '/api/v3/ping' : '/fapi/v1/ping');
  }

  /** 当前选中的可用主机（触发一次探测） */
  async activeBase(market: Market): Promise<string> {
    return this.pickBase(market);
  }

  async serverTime(market: Market): Promise<number> {
    const r = await this.request<{ serverTime: number }>(market, 'GET', market === 'SPOT' ? '/api/v3/time' : '/fapi/v1/time');
    return r.serverTime;
  }

  async exchangeInfo(market: Market): Promise<SymbolInfo[]> {
    const raw = await this.request<RawExchangeInfo>(market, 'GET', market === 'SPOT' ? '/api/v3/exchangeInfo' : '/fapi/v1/exchangeInfo');
    return raw.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => parseSymbolFilters(s.symbol, market, s.filters, s.quotePrecision, s.baseAssetPrecision));
  }

  async klines(market: Market, symbol: string, interval: Interval, opts: { startTime?: number; endTime?: number; limit?: number } = {}): Promise<Candle[]> {
    const raw = await this.request<RawKlineRow[]>(market, 'GET', market === 'SPOT' ? '/api/v3/klines' : '/fapi/v1/klines', {
      symbol, interval, startTime: opts.startTime, endTime: opts.endTime, limit: opts.limit ?? 1000,
    });
    return raw.map(parseKlineRow);
  }

  async tickers(market: Market, symbols?: string[]): Promise<Ticker[]> {
    const path = market === 'SPOT' ? '/api/v3/ticker/24hr' : '/fapi/v1/ticker/24hr';
    const raw = await this.request<RawTicker[]>(market, 'GET', path, symbols ? { symbols: JSON.stringify(symbols) } : {});
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map((t) => ({
      symbol: t.symbol, market, lastPrice: parseFloat(t.lastPrice),
      priceChangePercent: parseFloat(t.priceChangePercent), high24h: parseFloat(t.highPrice),
      low24h: parseFloat(t.lowPrice), volume: parseFloat(t.volume), quoteVolume: parseFloat(t.quoteVolume),
      openPrice: parseFloat(t.openPrice), prevClosePrice: parseFloat(t.prevClosePrice), closeTime: t.closeTime,
    }));
  }

  async ticker(market: Market, symbol: string): Promise<Ticker> {
    const list = await this.tickers(market, [symbol]);
    const t = list[0];
    if (!t) throw new Error('no ticker for ' + symbol);
    return t;
  }

  /** 仅合约：标记价格与资金费率 */
  async markPrices(market: Market): Promise<MarkPrice[]> {
    if (market !== 'USDT_M') return [];
    const raw = await this.request<RawMarkPrice[]>(market, 'GET', '/fapi/v1/premiumIndex');
    return raw.map((m) => ({
      symbol: m.symbol, markPrice: parseFloat(m.markPrice), indexPrice: parseFloat(m.indexPrice),
      fundingRate: parseFloat(m.lastFundingRate), nextFundingTime: m.nextFundingTime,
    }));
  }

  async aggTrades(market: Market, symbol: string, opts: { limit?: number; fromId?: number; startTime?: number; endTime?: number } = {}): Promise<AggTrade[]> {
    const raw = await this.request<RawAggTrade[]>(market, 'GET', market === 'SPOT' ? '/api/v3/aggTrades' : '/fapi/v1/aggTrades', {
      symbol, limit: opts.limit ?? 500, fromId: opts.fromId, startTime: opts.startTime, endTime: opts.endTime,
    });
    return raw.map((a) => ({ id: a.a, price: parseFloat(a.p), qty: parseFloat(a.q), time: a.T, isBuyerMaker: a.m }));
  }

  /** 私有只读：账户信息（用于真实账户对账，本系统不会用它下单） */
  async accountBalances(market: Market): Promise<Record<string, number>> {
    const raw = await this.request<{ balances?: { asset: string; free: string; locked: string }[]; assets?: { asset: string; walletBalance: string; availableBalance: string }[] }>(
      market, 'GET', market === 'SPOT' ? '/api/v3/account' : '/fapi/v2/account', { recvWindow: 10000 }, true,
    );
    const out: Record<string, number> = {};
    if (market === 'SPOT' && raw.balances) {
      for (const b of raw.balances) out[b.asset] = parseFloat(b.free);
    } else if (raw.assets) {
      for (const b of raw.assets) out[b.asset] = parseFloat(b.walletBalance);
    }
    return out;
  }
}
