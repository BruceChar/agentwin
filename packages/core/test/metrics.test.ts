import { describe, expect, it } from 'vitest';
import type { BacktestTrade, EquityPoint } from '@agentwin/shared';
import { computeMetrics, maxDrawdown } from '../src/metrics.ts';

function eq(vals: number[]): EquityPoint[] {
  return vals.map((v, i) => ({ accountId: 'a', timestamp: i * 3_600_000, equity: v, cash: v, unrealizedPnl: 0 }));
}

function trade(pnl: number): BacktestTrade {
  return { index: 0, entryTime: 0, exitTime: 1, side: 'LONG', entryPrice: 100, exitPrice: 100 + pnl, qty: 1, pnl, pnlPct: pnl / 100, fees: 0, holdBars: 1, reason: 'x' };
}

describe('maxDrawdown', () => {
  it('computes drawdown from peak', () => {
    const dd = maxDrawdown([100, 120, 90, 110, 80, 100]);
    expect(dd.maxDrawdown).toBeCloseTo((120 - 80) / 120, 5);
    expect(dd.peak).toBe(120);
    expect(dd.trough).toBe(80);
  });
});

describe('computeMetrics', () => {
  it('empty series', () => {
    const m = computeMetrics(eq([10000]), [], { intervalMs: 3_600_000 });
    expect(m.totalReturn).toBe(0);
    expect(m.finalEquity).toBe(10000);
  });

  it('profitable trades', () => {
    const m = computeMetrics(eq([10000, 10500]), [trade(300), trade(200)], { intervalMs: 3_600_000 });
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(0);
    expect(m.winRate).toBe(1);
    expect(m.totalTrades).toBe(2);
    expect(m.avgWin).toBe(250);
  });

  it('mixed trades win rate and profit factor', () => {
    const m = computeMetrics(eq([10000, 10100, 10050]), [trade(100), trade(-50)], { intervalMs: 3_600_000 });
    expect(m.winRate).toBe(0.5);
    expect(m.profitFactor).toBe(2);
  });
});
