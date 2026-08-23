// ================= 领域模型 =================
// 全部使用 erasable TS（无 enum），与 Node 原生 type-stripping 兼容。

export type Market = 'SPOT' | 'USDT_M' | 'COIN_M' | 'MARGIN' | 'MARGIN_ISOLATED';

/** 市场展示名（中文） */
export const MARKET_LABELS: Record<Market, string> = {
  SPOT: '现货',
  USDT_M: 'U本位合约',
  COIN_M: '币本位合约',
  MARGIN: '全仓杠杆',
  MARGIN_ISOLATED: '逐仓杠杆',
};

/** 真实账户对账涉及的市场列表 */
export const REAL_ACCOUNT_MARKETS: Market[] = ['SPOT', 'MARGIN', 'MARGIN_ISOLATED', 'USDT_M', 'COIN_M'];
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
  market: Market;
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

// ---------- 交易日志（简单笔记） ----------
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

// ---------- 结构化交易日志（核心：用于迭代交易系统） ----------
export type PlanExecution = 'complete' | 'partial' | 'none';
export type JournalTag = '情绪化交易' | '执行错误' | '系统缺陷' | '正常亏损' | '正常盈利' | '运气成分' | string;

/** 每笔交易一条，A-G 七段结构；JSONL 主存储 + SQLite 辅助查询 */
export interface TradeJournal {
  id: string;
  accountId?: string;

  // A. 基本信息
  tradeNo: string;              // 交易编号，如 20260821-001
  symbol: string;               // 品种/市场，如 BTCUSDT
  market: string;               // 现货 / U本位合约 / 币本位合约 / 全仓杠杆 / 逐仓杠杆 / 外汇 / A股 ...
  direction: 'LONG' | 'SHORT';  // 交易方向
  timeframe?: string;           // 5分钟 / 1小时 / 日线
  strategyVersion?: string;     // 策略版本 / 交易计划编号
  subAccount?: string;          // 账户/子账户
  openTime?: number;            // 开仓时间(ms)
  closeTime?: number;           // 平仓时间(ms)

  // B. 交易前计划（按交易计划模板：目标/品种/方向/杠杠/仓位/账户资金/开仓价/止损/止盈/理由/胜率/盈亏比/策略/失效）
  strategyName?: string;        // 策略名称（与 strategyVersion 拆开，如 趋势跟踪）
  plannedEntry?: number;        // 计划开仓价格（区间中点）
  plannedStop?: number;         // 计划止损价（必填；由 plannedStops 首档推导，% 档换算为价格）
  plannedTargets?: number[];    // 计划止盈价（价格档目标，兼容统计用）
  plannedRR?: string;           // 目标盈亏比，如 "1:3"
  plannedSize?: string;         // 仓位/数量，如 "0.5 手"
  plannedRiskAmount?: number;   // 计划最大风险金额
  plannedRiskPct?: number;      // 计划最大风险百分比（占账户资金）
  plannedHolding?: string;      // 计划持仓周期：日内/波段/趋势
  estimatedWinRate?: number;    // 预估胜率 0-100
  /** 止损位：价格或百分比，数组（可分批），每档可带仓位比 */
  plannedStops?: { mode: 'price' | 'pct'; value?: number; ratio?: number }[];
  /** 止盈位：价格或百分比，数组（可分批），每档可带仓位比 */
  plannedTargetsDetail?: { mode: 'price' | 'pct'; value?: number; ratio?: number }[];
  invalidation?: string;        // 失效/取消条件

  // C. 实际执行
  actualEntry?: number;         // 实际开仓价
  actualExit?: number;          // 实际平仓价
  actualQty?: number;           // 实际数量
  leverage?: number;            // 杠杆倍数
  orderType?: string;           // 市价单/限价单/条件单
  slippage?: number;            // 滑点
  holdingDuration?: string;     // 持仓时长，如 "4 小时 15 分钟"
  planExecution: PlanExecution; // 是否按计划执行
  deviationReason?: string;     // 偏差原因

  // D. 市场条件
  marketTrend?: string;         // 看涨/看跌/震荡
  volatility?: string;          // ATR、布林带宽度等
  volumeLiquidity?: string;     // 放量/缩量/深度
  supportResistance?: string;   // 关键支撑阻力/市场结构
  economicEvents?: string;      // 重要经济数据/事件
  indicatorState?: string;      // 技术指标状态
  relatedSymbols?: string;      // 相关品种表现
  session?: string;             // 亚盘/欧盘/美盘

  // E. 情绪与决策
  entryReason?: string;         // 入场理由
  exitReason?: string;          // 出场理由：止盈/止损/手动离场/时间离场
  emotionScore?: number;        // 情绪评分 1-10（1=冷静 10=恐惧/贪婪）
  confidenceScore?: number;     // 信心评分 1-10
  psychologicalNote?: string;   // 持仓过程心理变化
  emotionAffected?: boolean;    // 是否受情绪影响操作

  // F. 结果分析（可自动计算）
  pnl?: number;                 // 盈亏金额
  pnlPct?: number;              // 盈亏百分比
  fees?: number;                // 交易费用明细
  netPnl?: number;              // 净收益
  rMultiple?: number;           // R 倍数 = 盈亏 ÷ 初始风险
  mfe?: number;                 // 最大浮盈
  mae?: number;                 // 最大浮亏
  attribution?: string;         // 盈亏归因：系统信号/执行质量/市场运气/情绪干扰

  // G. 复盘总结与迭代
  disciplineScore?: number;     // 规则符合度 1-10
  signalCorrect?: boolean;      // 系统信号是否正确
  strengths?: string;           // 成功的方面
  improvements?: string;        // 需要改进的方面
  nextPlan?: string;            // 后续计划
  tags: JournalTag[];           // 情绪化交易/执行错误/系统缺陷/正常亏损/正常盈利/运气成分
  postCloseVerification?: string; // 交易后市场走势验证

  /** 自动从行情提取的指标（开仓时点的 RSI/ATR/EMA 等） */
  indicators?: Record<string, number | string | boolean | null>;
  /** 自动提取结果说明 */
  autoNotes?: string[];

  // H. 四态流转（设计规范 v3.2）：计划中 plan / 持仓中 holding / 待复盘 pending / 已复盘 done
  status?: 'plan' | 'holding' | 'pending' | 'done';
  /** 计划预期执行时间（ms） */
  plannedAt?: number;
  /** 触发条件文本描述 */
  triggerDesc?: string;
  /** 入场质量评分 1-10 */
  entryQuality?: number;
  /** 入场质量一句话总结 */
  entryQualityNote?: string;
  /** 出场质量评分 1-10 */
  exitQuality?: number;
  /** 出场质量一句话总结 */
  exitQualityNote?: string;
  /** 策略调整建议（复盘时选择「是」时记录） */
  strategyAdjustment?: { strategy?: string; direction?: string };

  createdAt: number;
  updatedAt: number;
}

export type NewTradeJournal = Omit<TradeJournal, 'id' | 'createdAt' | 'updatedAt' | 'planExecution' | 'tags'> & Partial<Pick<TradeJournal, 'planExecution' | 'tags'>>;

/** 交易日志统计（迭代交易系统用） */
export interface TradeJournalStats {
  total: number;
  closed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  expectancy: number;       // 期望值 = 平均R × 胜率...
  profitFactor: number;
  netPnl: number;
  avgDiscipline: number;
  avgEmotion: number;
  tagFrequency: Record<string, number>;
  byStrategy: Record<string, { total: number; winRate: number; avgR: number; netPnl: number }>;
  byMarket: Record<string, { total: number; winRate: number; netPnl: number }>;
  planDeviation: { complete: number; partial: number; none: number };
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
