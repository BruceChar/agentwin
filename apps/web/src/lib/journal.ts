// ================= 交易日志四态模型（设计规范 v3.2） =================
// 计划中 → 持仓中 → 待复盘 → 已复盘

/** TradeJournal 本地视图类型（与 packages/shared 对齐；web 不直接依赖 shared 包） */
export interface TradeJournal {
  id: string;
  accountId?: string;
  tradeNo?: string;
  symbol: string;
  market?: string;
  direction: 'LONG' | 'SHORT';
  timeframe?: string;
  strategyVersion?: string;
  strategyName?: string;
  subAccount?: string;
  openTime?: number;
  closeTime?: number;
  plannedEntry?: number;
  plannedStop?: number;
  plannedTargets?: number[];
  plannedRR?: string;
  plannedSize?: string;
  plannedRiskAmount?: number;
  plannedRiskPct?: number;
  plannedHolding?: string;
  invalidation?: string;
  actualEntry?: number;
  actualExit?: number;
  actualQty?: number;
  leverage?: number;
  orderType?: string;
  holdingDuration?: string;
  planExecution?: 'complete' | 'partial' | 'none';
  deviationReason?: string;
  marketTrend?: string;
  volatility?: string;
  volumeLiquidity?: string;
  supportResistance?: string;
  economicEvents?: string;
  indicatorState?: string;
  entryReason?: string;
  exitReason?: string;
  emotionScore?: number;
  confidenceScore?: number;
  emotionAffected?: boolean;
  pnl?: number;
  pnlPct?: number;
  fees?: number;
  netPnl?: number;
  rMultiple?: number;
  mfe?: number;
  mae?: number;
  attribution?: string;
  disciplineScore?: number;
  signalCorrect?: boolean;
  strengths?: string;
  improvements?: string;
  nextPlan?: string;
  tags?: string[];
  postCloseVerification?: string;
  status?: 'plan' | 'holding' | 'pending' | 'done';
  plannedAt?: number;
  triggerDesc?: string;
  entryQuality?: number;
  entryQualityNote?: string;
  exitQuality?: number;
  exitQualityNote?: string;
  strategyAdjustment?: { strategy?: string; direction?: string };
  createdAt?: number;
  updatedAt?: number;
}

export type JournalStatus = 'plan' | 'holding' | 'pending' | 'done';

export const STATUS_META: Record<JournalStatus, {
  label: string;
  color: string;
  dot: string;
  cls: string;          // aw-status-* class
  border: string;       // 卡片边框样式
}> = {
  plan:    { label: '计划中', color: '#F59E0B', dot: '#F59E0B', cls: 'aw-status-plan',    border: '1px dashed rgba(245,158,11,0.5)' },
  holding: { label: '持仓中', color: '#06B6D4', dot: '#06B6D4', cls: 'aw-status-holding', border: '1px solid rgba(6,182,212,0.5)' },
  pending: { label: '待复盘', color: '#EF4444', dot: '#EF4444', cls: 'aw-status-pending', border: '1px solid rgba(239,68,68,0.5)' },
  done:    { label: '已复盘', color: '#10B981', dot: '#10B981', cls: 'aw-status-done',    border: '1px solid rgba(255,255,255,0.08)' },
};

export const STATUS_ORDER: JournalStatus[] = ['plan', 'holding', 'pending', 'done'];

/**
 * 状态派生：从记录字段推导四态。
 * - 已复盘：disciplineScore 已填写
 * - 待复盘：已平仓（closeTime/actualExit 有值）但未复盘；或历史导入标记
 * - 持仓中：已开仓（actualEntry/openTime 有值）未平仓
 * - 计划中：仅有计划字段
 */
export function deriveStatus(j: Pick<TradeJournal, 'disciplineScore' | 'closeTime' | 'actualExit' | 'actualEntry' | 'openTime' | 'status'>): JournalStatus {
  if (j.status === 'plan' || j.status === 'holding' || j.status === 'pending' || j.status === 'done') return j.status;
  if (j.disciplineScore !== undefined && j.disciplineScore !== null) return 'done';
  const closed = j.closeTime !== undefined && j.closeTime !== null && j.closeTime > 0;
  const exited = j.actualExit !== undefined && j.actualExit !== null;
  if (closed || exited) return 'pending';
  const opened = j.actualEntry !== undefined && j.actualEntry !== null && j.actualEntry > 0;
  const openedAt = j.openTime !== undefined && j.openTime !== null && j.openTime > 0;
  if (opened || openedAt) return 'holding';
  return 'plan';
}

/** 待复盘提示 */
export function pendingHint(j: TradeJournal): string {
  if (deriveStatus(j) !== 'pending') return '';
  const hasLog = !!(j.entryReason || j.emotionScore !== undefined || (j.tags?.length ?? 0) > 0);
  return hasLog ? '需完成复盘' : '需补记日志与复盘';
}

/** 已复盘摘要 */
export function doneSummary(j: TradeJournal): string {
  const d = j.disciplineScore;
  return d !== undefined ? '复盘完成 · 执行力 ' + d + '/10' : '复盘完成';
}

/** 盈亏格式化 */
export function fmtPnl(v: number | undefined, digits = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(digits);
}

export function fmtNum(v: number | undefined, digits = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export function fmtPrice(v: number | undefined, digits = 4): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

/** 时间格式化 */
export function fmtTime(ts: number | undefined, withTime = true): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', withTime
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function fmtFullTime(ts: number | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 持仓时长（ms → 可读字符串） */
export function fmtDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return '—';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return '不足 1 分钟';
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return h + ' 小时' + (rm ? ' ' + rm + ' 分' : '');
  const d = Math.floor(h / 24);
  return d + ' 天 ' + (h % 24) + ' 小时';
}

/** 由记录计算持仓时长 */
export function holdingDuration(j: TradeJournal): number | undefined {
  const a = j.openTime ?? j.createdAt;
  const b = j.closeTime ?? Date.now();
  if (!a) return undefined;
  return b - a;
}

/** 方向标签 */
export function dirLabel(d: string | undefined): string {
  return d === 'SHORT' ? '空' : '多';
}

/** 常见计价币（报价币），匹配时按数组顺序取最长优先 */
const QUOTE_CURRENCIES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'EUR', 'TRY', 'BRL', 'USD'];

/** 合约后缀（拆币对前剥掉）：BTCUSD_PERP → BTCUSD */
const SYMBOL_SUFFIXES = ['_PERP', '_USDT', '_USDC', '_BUSD', '_FUT'];

/** 拆币对：BTCUSDT → { base: 'BTC', quote: 'USDT' }；BTCUSDC → { base: 'BTC', quote: 'USDC' }；BTCUSD_PERP → { base: 'BTC', quote: 'USD' }；无法识别时报价币默认 USDT */
export function splitSymbol(symbol: string | undefined): { base: string; quote: string } {
  let sym = (symbol ?? '').trim().toUpperCase();
  for (const suf of SYMBOL_SUFFIXES) {
    if (sym.endsWith(suf) && sym.length > suf.length) { sym = sym.slice(0, -suf.length); break; }
  }
  for (const q of QUOTE_CURRENCIES) {
    if (sym.endsWith(q) && sym.length > q.length) return { base: sym.slice(0, -q.length), quote: q };
  }
  return { base: sym, quote: 'USDT' };
}

/** 价格单位（计价币）：BTCUSDT → USDT，BTCUSDC → USDC */
export function quoteCurrency(symbol: string | undefined): string {
  return splitSymbol(symbol).quote;
}

/**
 * 仓位 / 风险金额单位：
 * - 逐仓杠杆以币种计（BTCUSDT → BTC）；
 * - 其余市场（U本位合约 / 币本位合约 / 现货 / 全仓杠杆）以计价币计（USDT / USDC 等）。
 */
export function positionUnit(symbol: string | undefined, market?: string): string {
  const { base, quote } = splitSymbol(symbol);
  return market === '逐仓杠杆' ? base : quote;
}

/** 交易类型（创建计划下拉选项） */
export const MARKET_OPTIONS = ['现货', 'U本位合约', '币本位合约', '全仓杠杆', '逐仓杠杆'];

/** 期望值/统计工具 */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 简单深拷贝 */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
