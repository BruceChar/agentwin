import type { TradeIntent, Strategy } from '../strategy.ts';
import { bool, num } from '../strategy.ts';
import { crossOver, crossUnder, sma } from '@agentwin/core';
import type { Candle, StrategyParamValue } from '@agentwin/shared';

export function createMaCrossStrategy(): Strategy {
  return {
    id: 'ma_cross',
    name: 'MA Cross 均线交叉',
    description: '快线上穿慢线开多，下穿平仓。趋势跟踪型。',
    paramSpecs: [
      { name: 'fast', type: 'number', default: 10, min: 2, max: 100, step: 1, description: '快线周期' },
      { name: 'slow', type: 'number', default: 30, min: 5, max: 300, step: 1, description: '慢线周期' },
      { name: 'sizePct', type: 'number', default: 0.95, min: 0.05, max: 1, step: 0.05, description: '每次开仓使用权益比例' },
      { name: 'allowShort', type: 'boolean', default: false, description: '合约市场是否允许开空' },
    ],
    onBar(ctx, bar, index): TradeIntent | null {
      const fast = num(ctx, 'fast');
      const slow = num(ctx, 'slow');
      if (slow <= fast) return null;
      const closes = ctx.bars.map((b) => b.close);
      const sFast = sma(closes, fast);
      const sSlow = sma(closes, slow);
      if (crossOver(sFast, sSlow, index)) {
        if (ctx.positionSide !== 'FLAT') return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: 'MA cross up' };
        return { action: 'OPEN_LONG', sizeMode: 'pct', size: num(ctx, 'sizePct'), reason: 'fast MA crosses above slow MA' };
      }
      if (crossUnder(sFast, sSlow, index)) {
        if (ctx.positionSide !== 'FLAT') return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: 'fast MA crosses below slow MA' };
        if (bool(ctx, 'allowShort') && ctx.market === 'USDT_M') return { action: 'OPEN_SHORT', sizeMode: 'pct', size: num(ctx, 'sizePct'), reason: 'fast MA below slow MA, short' };
      }
      return null;
    },
    describe(): string {
      return 'MA Cross：计算 fast 与 slow 周期简单移动平均，快线上穿慢线时开多（或平空），下穿时平多（合约可开空）。参数：fast/slow 均线周期、sizePct 仓位比例、allowShort 是否允许做空。';
    },
  };
}
