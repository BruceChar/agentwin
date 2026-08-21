import type { AggTrade, Candle, Interval, Market, MarkPrice, SymbolInfo, Ticker } from '@agentwin/shared';
import { buildQueryString, buildSignedQuery } from './sign.ts';
import type { RawAggTrade, RawExchangeInfo, RawKlineRow, RawMarkPrice, RawSymbolFilter, RawTicker } from './types.ts';
import { FUTURES_BASE, SPOT_BASE, SPOT_TESTNET_BASE, pickReachableBase, pickSignedBase as pickSignedBaseHost, probeBase, type HostOptions } from './hosts.ts';
import { createProxiedFetch, getProxyDispatcher, isDirectHost, isGeoRestricted, geoRestrictedHint, resolveProxyConfig, type ProxyConfig } from './proxy.ts';

// 常量与错误类型由 hosts.ts 提供，这里统一再导出（兼容既有引用）
export { SPOT_BASE, SPOT_TESTNET_BASE, SPOT_DATA_API_BASE, FUTURES_BASE, MarketDataUnavailableError, restCandidatesFor } from './hosts.ts';

export interface RestOptions extends HostOptions {
  apiKey?: string;
  apiSecret?: string;
  timeoutMs?: number;
  /** 注入 fetch（测试用），默认全局 fetch */
  fetchImpl?: typeof fetch;
  /** 代理配置；缺省按 BINANCE_PROXY / BINANCE_PROXY_URL / HTTPS_PROXY 解析 */
  proxyConfig?: ProxyConfig;
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
  private readonly proxyConfig: ProxyConfig;
  /** market -> 已选中的可用 base（带时间戳缓存） */
  private baseCache = new Map<Market, { url: string; at: number }>();

  private readonly proxiedFetch: typeof fetch | undefined;

  constructor(opts: RestOptions = {}) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.proxyConfig = opts.proxyConfig ?? resolveProxyConfig();
    // 走代理时必须用 undici 自带 fetch（Node 全局 fetch 与 undici ProxyAgent 版本不兼容）
    this.proxiedFetch = createProxiedFetch(this.proxyConfig);
  }

  /** 统一请求入口：公共行情主机（data-api/data-stream）永远直连；其余按代理配置走 */
  private doFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    const url = String(input);
    if (isDirectHost(url)) return this.fetchImpl(url, init ?? {});
    return this.proxiedFetch ? this.proxiedFetch(url, init) : this.fetchImpl(url, init ?? {});
  }

  /** 当前代理配置（诊断/状态展示用） */
  get proxy(): ProxyConfig {
    return this.proxyConfig;
  }

  /** 选择可用主机（缓存 5 分钟；失败自动重探） */
  private async pickBase(market: Market): Promise<string> {
    const cached = this.baseCache.get(market);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.url;
    const url = await pickReachableBase(market, this.opts, this.doFetch.bind(this));
    this.baseCache.set(market, { url, at: Date.now() });
    return url;
  }

  /** 签名请求主机：api.binance.com 不可达时自动回退 api1-4（官方备用域名，Key 同样有效） */
  private async pickSignedBase(market: Market): Promise<string> {
    const key = (market + ':signed') as Market;
    const cached = this.baseCache.get(key);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.url;
    const url = await pickSignedBaseHost(market, this.opts, this.doFetch.bind(this));
    this.baseCache.set(key, { url, at: Date.now() });
    return url;
  }

  private async request<T>(market: Market, method: string, path: string, params: Record<string, string | number | boolean | undefined> = {}, signed = false): Promise<T> {
    // 签名请求走官方主端点，api.binance.com 不可达时自动回退 api1-4（Key 在备用域名同样有效）
    const base = signed
      ? (this.opts.testnet ? SPOT_TESTNET_BASE : await this.pickSignedBase(market))
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
    const init: RequestInit = { method, headers, signal: ctrl.signal };
    try {
      const res = await this.doFetch(url, init);
      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch { /* ignore */ }
        if (isGeoRestricted(body)) {
          throw new Error('币安地理封锁（受限地区出口 IP）：' + geoRestrictedHint() + ' 原始响应: ' + body.slice(0, 160));
        }
        throw new Error('Binance ' + market + ' ' + method + ' ' + path + ' -> ' + res.status + ': ' + body.slice(0, 300));
      }
      if (res.status === 204) return undefined as T;
      const bodyText = await res.text().catch(() => '');
      if (!bodyText.trim()) {
        throw new Error('Binance ' + market + ' ' + method + ' ' + path + ' -> ' + res.status + ': 响应为空（可能被代理/网关拦截或地理封锁）');
      }
      try {
        return JSON.parse(bodyText) as T;
      } catch {
        throw new Error('Binance ' + market + ' ' + method + ' ' + path + ' -> ' + res.status + ': 响应非 JSON: ' + bodyText.slice(0, 160));
      }
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

  /** 官方主端点快速连通性探测（4s；用于真实账户状态检查，避免长时间阻塞） */
  async reachable(): Promise<boolean> {
    return probeBase(SPOT_BASE, 'SPOT', this.doFetch.bind(this));
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

  // ================= 私有只读：账户/成交/挂单（真实账户对账用；本系统从不经此下单） =================

  /** 现货账户：全部资产余额 */
  async spotAccount(): Promise<SpotAccountInfo> {
    const raw = await this.request<{
      balances?: { asset: string; free: string; locked: string }[];
      canTrade?: boolean; accountType?: string;
    }>('SPOT', 'GET', '/api/v3/account', { recvWindow: 10000 }, true);
    return {
      balances: (raw.balances ?? []).map((b) => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) })),
    };
  }

  /** U本位合约账户：钱包余额 + 持仓 */
  async futuresAccount(): Promise<FuturesAccountInfo> {
    const raw = await this.request<{
      assets?: { asset: string; walletBalance: string; availableBalance: string }[];
      positions?: {
        symbol: string; positionSide: string; positionAmt: string; entryPrice: string;
        markPrice: string; unrealizedProfit: string; realizedProfit: string;
      }[];
      totalWalletBalance?: string; totalUnrealizedProfit?: string; totalMarginBalance?: string;
    }>('USDT_M', 'GET', '/fapi/v2/account', { recvWindow: 10000 }, true);
    return {
      balances: (raw.assets ?? []).map((a) => ({ asset: a.asset, walletBalance: parseFloat(a.walletBalance), availableBalance: parseFloat(a.availableBalance) })),
      positions: (raw.positions ?? [])
        .filter((p) => parseFloat(p.positionAmt) !== 0)
        .map((p) => ({
          symbol: p.symbol, positionSide: p.positionSide, positionAmt: parseFloat(p.positionAmt),
          entryPrice: parseFloat(p.entryPrice), markPrice: parseFloat(p.markPrice),
          unrealizedProfit: parseFloat(p.unrealizedProfit), realizedProfit: parseFloat(p.realizedProfit),
        })),
      totalWalletBalance: parseFloat(raw.totalWalletBalance ?? '0'),
      totalUnrealizedProfit: parseFloat(raw.totalUnrealizedProfit ?? '0'),
      totalMarginBalance: parseFloat(raw.totalMarginBalance ?? '0'),
    };
  }

  /** 我的成交（现货 /api/v3/myTrades；合约 /fapi/v1/userTrades），按 symbol 查询 */
  async myTrades(market: Market, symbol: string, opts: { limit?: number; fromId?: number } = {}): Promise<MyTradeRow[]> {
    const raw = await this.request<RawMyTrade[]>(
      market, 'GET', market === 'SPOT' ? '/api/v3/myTrades' : '/fapi/v1/userTrades',
      { symbol, limit: opts.limit ?? 100, fromId: opts.fromId }, true,
    );
    return raw.map((t) => ({
      id: t.id, orderId: t.orderId, symbol: t.symbol, side: t.side as 'BUY' | 'SELL',
      price: parseFloat(t.price), qty: parseFloat(t.qty),
      commission: parseFloat(t.commission), commissionAsset: t.commissionAsset, time: t.time,
      realizedPnl: t.realizedPnl !== undefined ? parseFloat(t.realizedPnl) : undefined,
      positionSide: t.positionSide,
    }));
  }

  /** 当前挂单（现货 /api/v3/openOrders；合约 /fapi/v1/openOrders） */
  async openOrders(market: Market, symbol?: string): Promise<OpenOrderRow[]> {
    const raw = await this.request<RawOpenOrder[]>(
      market, 'GET', market === 'SPOT' ? '/api/v3/openOrders' : '/fapi/v1/openOrders',
      symbol ? { symbol } : {}, true,
    );
    return raw.map((o) => ({
      symbol: o.symbol, orderId: o.orderId, side: o.side as 'BUY' | 'SELL',
      type: o.type, price: parseFloat(o.price), origQty: parseFloat(o.origQty),
      executedQty: parseFloat(o.executedQty), status: o.status, time: o.time,
    }));
  }

  /** 兼容旧接口：现货返回 free，合约返回 walletBalance */
  async accountBalances(market: Market): Promise<Record<string, number>> {
    if (market === 'SPOT') {
      const info = await this.spotAccount();
      const out: Record<string, number> = {};
      for (const b of info.balances) if (b.free > 0) out[b.asset] = b.free;
      return out;
    }
    const info = await this.futuresAccount();
    const out: Record<string, number> = {};
    for (const b of info.balances) if (b.walletBalance > 0) out[b.asset] = b.walletBalance;
    return out;
  }
}

// ---------- 私有接口类型 ----------
export interface SpotAccountInfo {
  balances: { asset: string; free: number; locked: number }[];
}
export interface FuturesAccountInfo {
  balances: { asset: string; walletBalance: number; availableBalance: number }[];
  positions: {
    symbol: string; positionSide: string; positionAmt: number; entryPrice: number;
    markPrice: number; unrealizedProfit: number; realizedProfit: number;
  }[];
  totalWalletBalance: number;
  totalUnrealizedProfit: number;
  totalMarginBalance: number;
}
export interface MyTradeRow {
  id: number;
  orderId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  commission: number;
  commissionAsset: string;
  time: number;
  /** 仅合约成交有 */
  realizedPnl?: number;
  positionSide?: string;
}
export interface OpenOrderRow {
  symbol: string;
  orderId: number;
  side: 'BUY' | 'SELL';
  type: string;
  price: number;
  origQty: number;
  executedQty: number;
  status: string;
  time: number;
}

interface RawMyTrade {
  id: number; orderId: number; symbol: string; side: string; price: string; qty: string;
  commission: string; commissionAsset: string; time: number;
  realizedPnl?: string; positionSide?: string;
}
interface RawOpenOrder {
  symbol: string; orderId: number; side: string; type: string; price: string;
  origQty: string; executedQty: string; status: string; time: number;
}
