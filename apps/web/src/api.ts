// ================= REST API 封装 =================

const BASE = import.meta.env.VITE_API_BASE ?? '/api';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { message?: string };
      msg = j.message ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

// ---------- 类型（与后端对齐的视图子集） ----------
export interface EquityPoint { timestamp: number; equity: number; cash: number; unrealizedPnl: number }
export interface TradeAgg {
  totalTrades: number; wins: number; losses: number; winRate: number;
  netPnl: number; grossProfit: number; grossLoss: number; profitFactor: number; feesPaid: number;
}
export interface AccountSummary {
  id: string; name: string; type: string; balances: { market: string; asset: string; free: number; locked: number }[];
  positions: { symbol: string; market: string; side: string; quantity: number; avgEntryPrice: number; unrealizedPnl: number }[];
  markets: Record<string, {
    balances: { asset: string; free: number; locked: number }[];
    positions: { symbol: string; side: string; quantity: number; avgEntryPrice: number; unrealizedPnl: number }[];
  }>;
  equity: number | null; totalTrades: number; netPnl: number; winRate: number;
}

export const MARKET_LABELS: Record<string, string> = {
  SPOT: '现货', MARGIN: '全仓杠杆', MARGIN_ISOLATED: '逐仓杠杆', USDT_M: 'U本位合约', COIN_M: '币本位合约',
};
export interface StrategyMeta { id: string; name: string; description: string; paramSpecs: { name: string; default: number | string | boolean; min?: number; max?: number; step?: number }[] }
export interface StrategyConfig {
  id: string; name: string; description?: string; market: string; symbol: string; interval: string;
  parameters: Record<string, number | string | boolean>; source: string; enabled: boolean;
}
export interface BacktestResult {
  runId: string; metrics: {
    totalReturn: number; maxDrawdown: number; sharpe: number; winRate: number; profitFactor: number;
    totalTrades: number; finalEquity: number; annualizedReturn: number;
  };
  equityCurve: EquityPoint[]; trades: { side: string; entryPrice: number; exitPrice: number; pnl: number; reason: string }[];
}
export interface Trade { id: string; symbol: string; side: string; qty: number; price: number; fee: number; realizedPnl?: number; tradedAt: number; strategyId?: string }
export interface SentimentRecord {
  id: string; source: string; symbol: string; headline: string; body?: string; url?: string;
  publishedAt?: number; score: number; label: string; keywords: string[]; model?: string; createdAt: number;
}
/** 舆情聚合（后端 /api/sentiment/:symbol 返回） */
export interface SentimentAggregate {
  symbol: string;
  averageScore: number;
  label: string;
  count: number;
  latest: SentimentRecord[];
  distribution: { bullish: number; neutral: number; bearish: number };
  sources: Record<string, number>;
  keywords: { word: string; count: number; sentiment: 'positive' | 'negative' | 'neutral'; score: number }[];
  topics: { topic: string; count: number; score: number }[];
  series: { t: number; score: number | null; count: number }[];
  lastAt: number | null;
}
export interface JournalEntry { id: string; kind: string; title: string; body: string; tags: string[]; createdAt: number }
