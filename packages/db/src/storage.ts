import type {
  Account, Balance, Candle, CandleKey, EquityPoint, Interval, JournalEntry, JournalKind,
  LLMMessage, LLMSession, LLMSessionKind, Market, NewAccount, Order, NewOrder, OrderStatus,
  Position, SentimentRecord, StrategyConfig, Trade, TradeAggregates,
} from '@agentwin/shared';

export interface KlineFilter {
  symbol: string;
  market: Market;
  interval: Interval;
  from?: number;
  to?: number;
  limit?: number;
}

export interface OrderFilter {
  accountId?: string;
  strategyId?: string;
  symbol?: string;
  market?: Market;
  status?: OrderStatus;
  from?: number;
  to?: number;
  limit?: number;
}

export interface TradeFilter {
  accountId?: string;
  strategyId?: string;
  symbol?: string;
  market?: Market;
  from?: number;
  to?: number;
  limit?: number;
}

/** 回测运行记录（存储层视图，JSON 字段已反序列化） */
export interface BacktestRunRecord {
  id: string;
  strategyId?: string;
  symbol: string;
  market: Market;
  interval: Interval;
  from: number;
  to: number;
  initialCapital: number;
  request: unknown;
  result: unknown;
  metrics: unknown;
  createdAt: number;
}
export type BacktestRunInput = Omit<BacktestRunRecord, 'createdAt'>;

/**
 * 存储适配层：所有数据访问都通过该接口。
 * 默认实现 SQLite（Node 内置 node:sqlite，零依赖）；可按需实现 DuckDB / Postgres 适配，
 * 通过 createStorage({ engine }) 切换，业务层无感知。
 */
export interface StorageAdapter {
  readonly engine: string;

  init(): Promise<void>;
  close(): Promise<void>;

  // ---------- 账户 & 余额 ----------
  createAccount(a: NewAccount): Promise<Account>;
  getAccount(id: string): Promise<Account | null>;
  listAccounts(): Promise<Account[]>;
  /** market 缺省为 SPOT（兼容旧调用） */
  setBalance(accountId: string, asset: string, free: number, locked?: number, market?: Market): Promise<void>;
  getBalances(accountId: string, market?: Market): Promise<Balance[]>;

  // ---------- K 线 ----------
  upsertKlines(rows: (Candle & CandleKey)[]): Promise<number>;
  getKlines(f: KlineFilter): Promise<Candle[]>;
  countKlines(symbol: string, market: Market, interval: Interval): Promise<number>;

  // ---------- 订单 & 成交 ----------
  createOrder(o: NewOrder): Promise<Order>;
  patchOrder(id: string, patch: Partial<Order>): Promise<Order | null>;
  getOrder(id: string): Promise<Order | null>;
  listOrders(f?: OrderFilter): Promise<Order[]>;
  createTrade(t: Trade): Promise<Trade>;
  listTrades(f?: TradeFilter): Promise<Trade[]>;
  tradeAggregates(f?: TradeFilter): Promise<TradeAggregates>;

  // ---------- 持仓 ----------
  upsertPosition(p: Position): Promise<void>;
  getPositions(accountId: string): Promise<Position[]>;
  deletePosition(accountId: string, symbol: string, market: Market): Promise<void>;
  clearPositions(accountId: string): Promise<void>;

  // ---------- 策略 ----------
  createStrategy(s: StrategyConfig): Promise<StrategyConfig>;
  updateStrategy(id: string, patch: Partial<StrategyConfig>): Promise<StrategyConfig | null>;
  getStrategy(id: string): Promise<StrategyConfig | null>;
  listStrategies(): Promise<StrategyConfig[]>;

  // ---------- 权益曲线 ----------
  appendEquity(p: EquityPoint): Promise<void>;
  getEquityCurve(accountId: string, from?: number, to?: number): Promise<EquityPoint[]>;

  // ---------- LLM 会话 ----------
  createSession(s: { id?: string; kind: LLMSessionKind; title: string; meta?: Record<string, unknown> }): Promise<LLMSession>;
  appendMessage(m: { sessionId: string; role: LLMMessage['role']; content: string; toolCalls?: unknown[] }): Promise<LLMMessage>;
  getSession(id: string): Promise<LLMSession | null>;
  listSessions(kind?: LLMSessionKind): Promise<LLMSession[]>;
  listMessages(sessionId: string): Promise<LLMMessage[]>;

  // ---------- 舆情 ----------
  upsertSentiment(r: SentimentRecord): Promise<void>;
  listSentiment(f?: { symbol?: string; from?: number; to?: number; limit?: number }): Promise<SentimentRecord[]>;

  // ---------- 回测 ----------
  saveBacktest(b: Omit<BacktestRunRecord, 'id' | 'createdAt'> & { createdAt?: number }): Promise<BacktestRunRecord>;
  getBacktest(id: string): Promise<BacktestRunRecord | null>;
  listBacktests(limit?: number): Promise<BacktestRunRecord[]>;

  // ---------- 交易日志 ----------
  createJournalEntry(e: { id?: string; accountId?: string; kind: JournalKind; title: string; body: string; tags?: string[]; createdAt?: number }): Promise<JournalEntry>;
  listJournalEntries(f?: { accountId?: string; limit?: number }): Promise<JournalEntry[]>;
}
