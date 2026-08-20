import { randomUUID } from 'node:crypto';
import type { BacktestMetrics, BacktestResult, BacktestTrade, Candle, EquityPoint, Interval, Market, PositionSide, StrategyParamValue } from '@agentwin/shared';
import { computeMetrics } from '@agentwin/core';
import { SimulatedPortfolio, type ExecutionFill } from '@agentwin/core';
import type { Strategy } from '@agentwin/strategy';
import { normalizeParams } from '@agentwin/strategy';

export interface RunBacktestInput {
  strategy: Strategy;
  params: Record<string, StrategyParamValue>;
  symbol: string;
  market: Market;
  interval: Interval;
  candles: Candle[];
  initialCapital: number;
  feeRate?: number;
  slippageBps?: number;
  /** 回测结束是否强制平仓（默认 true，保证指标可比） */
  closeAtEnd?: boolean;
}

interface PositionLedger {
  side: PositionSide;
  qty: number;
  avgPrice: number;
  firstEntryTime: number;
  firstEntryIndex: number;
  entryFees: number;
  reason: string;
}

/**
 * 回测引擎：逐 K 线推进，策略 onBar → 意图 → 模拟成交（含手续费/滑点）→ 权益曲线 → 绩效指标。
 * 纯内存计算，不落库（由上层选择持久化 BacktestResult）。
 */
export async function runBacktest(input: RunBacktestInput): Promise<BacktestResult> {
  const { strategy, symbol, market, interval, candles, initialCapital } = input;
  const feeRate = input.feeRate ?? 0.001;
  const slippageBps = input.slippageBps ?? 2;
  const closeAtEnd = input.closeAtEnd ?? true;
  const params = normalizeParams(strategy, input.params);

  const portfolio = new SimulatedPortfolio(initialCapital, market, feeRate, slippageBps);
  const equityCurve: EquityPoint[] = [];
  const closedTrades: BacktestTrade[] = [];
  let ledger: PositionLedger | null = null;

  const pushEquity = (bar: Candle) => {
    portfolio.markToMarket({ [symbol]: bar.close });
    equityCurve.push({
      accountId: 'backtest', timestamp: bar.closeTime,
      equity: portfolio.equity, cash: portfolio.cash,
      unrealizedPnl: portfolio.positions.reduce((a, p) => a + p.unrealizedPnl, 0),
    });
  };

  const recordClose = (fill: ExecutionFill, reason: string, barIndex: number) => {
    if (fill.realizedPnl === undefined || !ledger) return;
    const notional = ledger.avgPrice * fill.qty;
    closedTrades.push({
      index: closedTrades.length,
      entryTime: ledger.firstEntryTime,
      exitTime: fill.tradedAt,
      side: ledger.side,
      entryPrice: ledger.avgPrice,
      exitPrice: fill.price,
      qty: fill.qty,
      pnl: fill.realizedPnl,
      pnlPct: notional > 0 ? fill.realizedPnl / notional : 0,
      fees: fill.fee + ledger.entryFees,
      holdBars: Math.max(barIndex - ledger.firstEntryIndex, 1),
      reason,
    });
  };

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i]!;
    const ctx = {
      symbol, market, interval,
      bars: candles.slice(0, i + 1),
      positionSide: (ledger?.side ?? 'FLAT') as 'LONG' | 'SHORT' | 'FLAT',
      positionQty: ledger?.qty ?? 0,
      equity: portfolio.equity,
      cash: portfolio.cash,
      params,
      indicators: {},
    };
    const intent = strategy.onBar(ctx, bar, i);
    if (intent && intent.action !== 'FLAT') {
      const pos = portfolio.positionFor(symbol);
      if (intent.action === 'CLOSE' && pos) {
        const fill = portfolio.executeMarketOrder(symbol, 'SELL', pos.quantity, {
          refPrice: bar.close, orderId: randomUUID(), tradedAt: bar.closeTime,
        });
        if (!fill.rejected && fill.fill.realizedPnl !== undefined) {
          recordClose(fill.fill, intent.reason, i);
        }
        ledger = null;
      } else if (intent.action === 'OPEN_LONG') {
        const qty = sizing(portfolio, intent.size, bar.close, market, 'LONG');
        if (qty > 0) {
          const fill = portfolio.executeMarketOrder(symbol, 'BUY', qty, {
            refPrice: bar.close, orderId: randomUUID(), tradedAt: bar.closeTime,
          });
          if (!fill.rejected) {
            ledger = {
              side: 'LONG', qty: fill.fill.qty, avgPrice: fill.fill.price,
              firstEntryTime: fill.fill.tradedAt, firstEntryIndex: i,
              entryFees: fill.fill.fee, reason: intent.reason,
            };
            if (fill.position) ledger.avgPrice = fill.position.avgEntryPrice;
          }
        }
      } else if (intent.action === 'OPEN_SHORT' && market === 'USDT_M') {
        const qty = sizing(portfolio, intent.size, bar.close, market, 'SHORT');
        if (qty > 0) {
          const fill = portfolio.executeMarketOrder(symbol, 'SELL', qty, {
            refPrice: bar.close, orderId: randomUUID(), tradedAt: bar.closeTime, allowReversal: true,
          });
          if (!fill.rejected) {
            ledger = {
              side: 'SHORT', qty: fill.fill.qty, avgPrice: fill.fill.price,
              firstEntryTime: fill.fill.tradedAt, firstEntryIndex: i,
              entryFees: fill.fill.fee, reason: intent.reason,
            };
            if (fill.position) ledger.avgPrice = fill.position.avgEntryPrice;
          }
        }
      }
    }
    pushEquity(bar);
  }

  // 强制平仓
  if (closeAtEnd && ledger) {
    const pos = portfolio.positionFor(symbol);
    if (pos && pos.quantity > 0) {
      const last = candles[candles.length - 1]!;
      const fill = portfolio.executeMarketOrder(symbol, 'SELL', pos.quantity, {
        refPrice: last.close, orderId: randomUUID(), tradedAt: last.closeTime,
      });
      if (!fill.rejected && fill.fill.realizedPnl !== undefined) {
        recordClose(fill.fill, 'end_of_backtest', candles.length - 1);
      }
    }
  }

  const metrics: BacktestMetrics = computeMetrics(equityCurve, closedTrades, { intervalMs: 3_600_000 });
  const runId = randomUUID();
  return {
    runId,
    request: {
      strategyId: strategy.id,
      strategy: { name: strategy.name, market, symbol, interval, parameters: params },
      symbol, market, interval,
      from: candles[0]?.openTime ?? 0,
      to: candles[candles.length - 1]?.openTime ?? 0,
      initialCapital, feeRate, slippageBps,
    },
    equityCurve, trades: closedTrades, metrics,
    generatedAt: Date.now(),
  };
}

function sizing(portfolio: SimulatedPortfolio, sizePct: number, price: number, market: Market, side: PositionSide): number {
  if (price <= 0) return 0;
  if (market === 'SPOT') {
    const qty = (portfolio.cash * Math.min(sizePct, 1)) / price;
    return qty > 0 ? qty : 0;
  }
  const qty = (portfolio.equity * Math.min(sizePct, 1)) / price;
  return qty > 0 ? qty : 0;
}
