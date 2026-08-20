import type { MarketEvent, StreamSubscription } from './provider.ts';
import type { RawWsAggTrade, RawWsBookTicker, RawWsKline, RawWsMarkPrice } from './binance/types.ts';

/** WebSocket 原始消息 → 统一 MarketEvent */
export function toMarketEvent(sub: StreamSubscription, raw: Record<string, unknown>): MarketEvent | null {
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
      return { ...base, bookTicker: { bidPrice: parseFloat(b.b), bidQty: parseFloat(b.B), askPrice: parseFloat(b.a), askQty: parseFloat(b.A) } };
    }
    case 'markPrice': {
      const m = raw as unknown as RawWsMarkPrice;
      return { ...base, markPrice: { markPrice: parseFloat(m.p), indexPrice: parseFloat(m.i), fundingRate: parseFloat(m.r), nextFundingTime: m.T } };
    }
  }
}
