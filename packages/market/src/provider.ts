import type { Candle, Interval, Market, SymbolInfo, Ticker } from '@agentwin/shared';

export interface KlineQuery {
  symbol: string;
  market: Market;
  interval: Interval;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export type StreamKind = 'kline' | 'aggTrade' | 'bookTicker' | 'markPrice';

export interface StreamSubscription {
  symbol: string;
  market: Market;
  stream: StreamKind;
  interval?: Interval;
}

export interface BookTicker {
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
}

export interface MarketEvent {
  symbol: string;
  market: Market;
  stream: StreamKind;
  candle?: Candle;
  aggTrade?: { id: number; price: number; qty: number; time: number; isBuyerMaker: boolean };
  bookTicker?: BookTicker;
  markPrice?: { markPrice: number; indexPrice: number; fundingRate: number; nextFundingTime: number };
}

export type Unsubscribe = () => void;

/**
 * 行情数据源抽象：真实 Binance（REST + WebSocket）或 Mock（离线/测试）。
 * 上层（回测 / paper trading）只依赖该接口。
 */
export interface PingResult {
  ok: boolean;
  host?: string;
  detail?: string;
}

export interface MarketDataProvider {
  readonly name: string;
  init(): Promise<void>;
  close(): Promise<void>;
  /** 连通性探测（健康检查用） */
  ping(): Promise<PingResult>;
  getKlines(q: KlineQuery): Promise<Candle[]>;
  getTicker(symbol: string, market: Market): Promise<Ticker>;
  getTickers(market: Market): Promise<Ticker[]>;
  getSymbols(market: Market): Promise<SymbolInfo[]>;
  subscribe(sub: StreamSubscription, cb: (e: MarketEvent) => void): Promise<Unsubscribe>;
}
