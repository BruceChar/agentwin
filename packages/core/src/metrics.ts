import type { BacktestMetrics, BacktestTrade, EquityPoint } from '@agentwin/shared';
import { stdev } from './indicators.ts';

export interface MaxDrawdownResult {
  maxDrawdown: number;
  peak: number;
  trough: number;
  peakIndex: number;
  troughIndex: number;
}

/** 最大回撤（正数表示回撤幅度，如 0.25 = 25%） */
export function maxDrawdown(equity: number[]): MaxDrawdownResult {
  let peak = -Infinity, peakIndex = 0;
  let maxDd = 0, trough = 0, troughIndex = 0;
  for (let i = 0; i < equity.length; i++) {
    const v = equity[i]!;
    if (v > peak) { peak = v; peakIndex = i; }
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDd) { maxDd = dd; trough = v; troughIndex = i; }
  }
  return { maxDrawdown: maxDd, peak: peak === -Infinity ? 0 : peak, trough, peakIndex, troughIndex };
}

const YEAR_MS = 365 * 24 * 3_600_000;

export interface MetricsOptions {
  /** 权益点间隔毫秒（用于年化） */
  intervalMs?: number;
}

/** 由权益曲线 + 交易记录计算绩效指标 */
export function computeMetrics(equity: EquityPoint[], trades: BacktestTrade[], opts: MetricsOptions = {}): BacktestMetrics {
  const eqVals = equity.map((p) => p.equity);
  const first = equity[0];
  const lastPt = equity[equity.length - 1];
  const initial = first?.equity ?? 0;
  const final = lastPt?.equity ?? initial;
  const startTime = first?.timestamp ?? 0;
  const endTime = lastPt?.timestamp ?? startTime;
  const totalReturn = initial > 0 ? final / initial - 1 : 0;
  const spanMs = Math.max(endTime - startTime, 1);
  const annualizedReturn = initial > 0 && final > 0
    ? Math.pow(final / initial, YEAR_MS / spanMs) - 1
    : 0;

  // 每期收益率序列
  const intervalMs = opts.intervalMs ?? (spanMs / Math.max(eqVals.length - 1, 1));
  const returns: number[] = [];
  for (let i = 1; i < eqVals.length; i++) {
    const prev = eqVals[i - 1]!;
    if (prev > 0) returns.push(eqVals[i]! / prev - 1);
  }
  const periodsPerYear = intervalMs > 0 ? YEAR_MS / intervalMs : 0;
  let sharpe = 0, sortino = 0;
  if (returns.length > 1) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const sd = stdev(returns);
    if (sd > 0 && periodsPerYear > 0) sharpe = (mean / sd) * Math.sqrt(periodsPerYear);
    const downside = returns.filter((r) => r < 0);
    if (downside.length > 0) {
      const dsd = stdev(downside);
      if (dsd > 0 && periodsPerYear > 0) sortino = (mean / dsd) * Math.sqrt(periodsPerYear);
    }
  }

  const dd = maxDrawdown(eqVals);
  const decided = trades.filter((t) => t.pnl !== 0);
  const wins = decided.filter((t) => t.pnl > 0);
  const losses = decided.filter((t) => t.pnl < 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const winRate = decided.length > 0 ? wins.length / decided.length : 0;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + t.pnl, 0) / losses.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const expectancy = decided.length > 0 ? (winRate * avgWin + (1 - winRate) * avgLoss) : 0;

  return {
    totalReturn, annualizedReturn, sharpe, sortino,
    maxDrawdown: dd.maxDrawdown,
    winRate, profitFactor, expectancy,
    totalTrades: trades.length, wins: wins.length, losses: losses.length,
    avgWin, avgLoss, finalEquity: final, peakEquity: dd.peak, startTime, endTime,
  };
}

/** 简易默认指标（无交易时可用） */
export function emptyMetrics(initial: number, at: number): BacktestMetrics {
  return {
    totalReturn: 0, annualizedReturn: 0, sharpe: 0, sortino: 0, maxDrawdown: 0,
    winRate: 0, profitFactor: 0, expectancy: 0, totalTrades: 0, wins: 0, losses: 0,
    avgWin: 0, avgLoss: 0, finalEquity: initial, peakEquity: initial, startTime: at, endTime: at,
  };
}
