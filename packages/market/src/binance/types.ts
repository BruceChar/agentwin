// ================= Binance 原始 API 类型 =================

export interface RawKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  trades: number;
  takerBuyBase: string;
  takerBuyQuote: string;
}

/** /api/v3/klines 与 /fapi/v1/klines 返回的是数组行 */
export type RawKlineRow = [
  number, string, string, string, string, string, number, string, number, string, string,
];

export interface RawSymbolFilter {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
}

export interface RawSymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetPrecision: number;
  quotePrecision: number;
  filters: RawSymbolFilter[];
}

export interface RawExchangeInfo {
  timezone: string;
  serverTime: number;
  symbols: RawSymbolInfo[];
}

export interface RawTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openPrice: string;
  prevClosePrice: string;
  closeTime: number;
}

export interface RawMarkPrice {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}

export interface RawAggTrade {
  a: number;
  p: string;
  q: string;
  T: number;
  m: boolean;
}

// ---------- WebSocket ----------
export interface RawWsKline {
  e: 'kline';
  s: string;
  k: {
    t: number; o: string; h: string; l: string; c: string; v: string;
    x: boolean; T: number; q: string; n: number; V: string; Q: string;
  };
}

export interface RawWsAggTrade {
  e: 'aggTrade';
  s: string;
  a: number;
  p: string;
  q: string;
  T: number;
  m: boolean;
}

export interface RawWsBookTicker {
  e: 'bookTicker';
  s: string;
  b: string;
  B: string;
  a: string;
  A: string;
}

export interface RawWsMarkPrice {
  e: 'markPriceUpdate';
  s: string;
  p: string;
  i: string;
  r: string;
  T: number;
}
