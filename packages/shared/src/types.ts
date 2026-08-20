// ================= 领域模型 =================
// 全部使用 erasable TS（无 enum），与 Node 原生 type-stripping 兼容。

export type Market = 'SPOT' | 'USDT_M';
export type OrderSide = 'BUY' | 'SELL';
export type PositionSide = 'LONG' | 'SHORT';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'STOP_LOSS_LIMIT' | 'TAKE_PROFIT' | 'TAKE_PROFIT_LIMIT';
export type OrderStatus = 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';
export type AccountType = 'paper' | 'real';

export const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] as const;
export type Interval = (typeof INTERVALS)[number];

export const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000, '8h': 28_800_000,
  '12h': 43_200_000, '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000, '1M': 2_592_000_000,
};

// ---------- 行情 ----------
export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
  takerBuyBase: number;
  takerBuyQuote: number;
}

export interface CandleKey {
  symbol: string;
  market: Market;
  interval: Interval;
  openTime: number;
}

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  market: Market;
  basePrecision: number;
  quotePrecision: number;
  pricePrecision: number;
  minQty: number;
  stepSize: number;
  minNotional: number;
  status: string;
  contractType?: string;
}

export interface Ticker {
  symbol: string;
  market: Market;
  lastPrice: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume: number;
  quoteVolume: number;
  openPrice: number;
  prevClosePrice: number;
  closeTime: number;
}

export interface AggTrade {
  id: number;
  price: number;
  qty: number;
  time: number;
  isBuyerMaker: boolean;
}

export interface MarkPrice {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  nextFundingTime: number;
}

// ---------- 账户 / 持仓 ----------
export interface Balance {
  accountId: string;
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, unknown>;
}

export interface NewAccount {
  id?: string;
  name: string;
  type: AccountType;
  currency?: string;
  meta?: Record<string, unknown>;
}

export interface Position {
  accountId: string;
  symbol: string;
  market: Market;
  side: PositionSide;
  quantity: number;
  avgEntryPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  updatedAt: number;
}

export interface EquityPoint {
  accountId: string;
  timestamp: number;
  equity: number;
  cash: number;
  unrealizedPnl: number;
}

// ---------- 订单 / 交易 ----------
export interface Order {
  id: string;
  accountId: string;
  strategyId?: string;
  symbol: string;
  market: Market;
  side: OrderSide;
  type: OrderType;
  price?: number;
  quantity: number;
  filledQty: number;
  avgFillPrice?: number;
  status: OrderStatus;
  fee?: number;
  feeAsset?: string;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, unknown>;
}

export interface NewOrder {
  id?: string;
  accountId: string;
  strategyId?: string;
  symbol: string;
  market: Market;
  side: OrderSide;
  type: OrderType;
  price?: number;
  quantity: number;
  createdAt?: number;
  meta?: Record<string, unknown>;
}

export interface Trade {
  id: string;
  orderId: string;
  accountId: string;
  strategyId?: string;
  symbol: string;
  market: Market;
  side: OrderSide;
  qty: number;
  price: number;
  fee: number;
  feeAsset?: string;
  /** 该笔成交估算的已实现盈亏（含费用） */
  pnl?: number;
  /** 该笔成交贡献的已实现盈亏（对平仓部分） */
  realizedPnl?: number;
  tradedAt: number;
  meta?: Record<string, unknown>;
}

// ---------- 策略 ----------
export type StrategySource = 'builtin' | 'user' | 'llm';
export type StrategyParamValue = number | string | boolean;

export interface StrategyConfig {
  id: string;
  name: string;
  description?: string;
  market: Market;
  symbol: string;
  interval: Interval;
  parameters: Record<string, StrategyParamValue>;
  source: StrategySource;
  enabled: boolean;
  parentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StrategySpec {
  id?: string;
  name: string;
  market: Market;
  symbol: string;
  interval: Interval;
  parameters: Record<string, StrategyParamValue>;
}

// ---------- 回测 ----------
export interface BacktestRequest {
  strategyId?: string;
  strategy?: StrategySpec;
  symbol: string;
  market: Market;
  interval: Interval;
  from: number;
  to: number;
  initialCapital: number;
  feeRate?: number;
  slippageBps?: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  totalTrades: number;
  wins: number;
  losses: number;
  avgWin: number;
  avgLoss: number;
  finalEquity: number;
  peakEquity: number;
  startTime: number;
  endTime: number;
}

export interface BacktestTrade {
  index: number;
  entryTime: number;
  exitTime: number;
  side: PositionSide;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  fees: number;
  holdBars: number;
  reason: string;
}

export interface BacktestResult {
  runId: string;
  request: BacktestRequest;
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  generatedAt: number;
}

export interface BacktestRun {
  id: string;
  strategyId?: string;
  symbol: string;
  market: Market;
  interval: Interval;
  from: number;
  to: number;
  initialCapital: number;
  requestJson: string;
  resultJson: string;
  metricsJson: string;
  createdAt: number;
}

// ---------- LLM ----------
export type LLMSessionKind = 'strategy' | 'iterate' | 'journal' | 'sentiment';
export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMSession {
  id: string;
  kind: LLMSessionKind;
  title: string;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, unknown>;
}

export interface LLMMessage {
  id: string;
  sessionId: string;
  role: LLMRole;
  content: string;
  toolCalls?: unknown[];
  createdAt: number;
}

// ---------- 舆情 ----------
export type SentimentLabel = 'bullish' | 'bearish' | 'neutral';
export type SentimentSource = 'news' | 'social' | 'rss' | 'manual';

export interface SentimentRecord {
  id: string;
  source: SentimentSource;
  symbol: string;
  headline: string;
  body?: string;
  url?: string;
  publishedAt?: number;
  /** -1 ~ 1 */
  score: number;
  label: SentimentLabel;
  keywords: string[];
  model?: string;
  createdAt: number;
}

// ---------- 交易日志 ----------
export type JournalKind = 'trade' | 'insight' | 'review' | 'note';

export interface JournalEntry {
  id: string;
  accountId?: string;
  kind: JournalKind;
  title: string;
  body: string;
  tags: string[];
  createdAt: number;
}

// ---------- 聚合统计 ----------
export interface TradeAggregates {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  feesPaid: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  bySymbol: Record<string, { trades: number; netPnl: number; winRate: number }>;
}

// ---------- 策略信号 ----------
export interface Signal {
  symbol: string;
  market: Market;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  strength: number;
  reason?: string;
  indicators?: Record<string, number>;
  timestamp: number;
}
