import type { Strategy, TradeIntent } from '../strategy.ts';
import { num } from '../strategy.ts';
import { rsi } from '@agentwin/core';

export function createRsiStrategy(): Strategy {
  return {
    id: 'rsi',
    name: 'RSI Reversal 超买超卖反转',
    description: 'RSI 进入超卖区开多，回到超买区平仓。震荡型。',
    paramSpecs: [
      { name: 'period', type: 'number', default: 14, min: 2, max: 60, step: 1, description: 'RSI 周期' },
      { name: 'oversold', type: 'number', default: 30, min: 10, max: 45, step: 1, description: '超卖阈值' },
      { name: 'overbought', type: 'number', default: 70, min: 55, max: 90, step: 1, description: '超买阈值' },
      { name: 'sizePct', type: 'number', default: 0.9, min: 0.05, max: 1, step: 0.05, description: '开仓比例' },
    ],
    onBar(ctx, bar, index): TradeIntent | null {
      const period = Math.floor(num(ctx, 'period'));
      const oversold = num(ctx, 'oversold');
      const overbought = num(ctx, 'overbought');
      const closes = ctx.bars.map((b) => b.close);
      const rs = rsi(closes, period);
      const v = rs[index] ?? null;
      if (v === null) return null;
      if (v < oversold) {
        if (ctx.positionSide === 'FLAT') return { action: 'OPEN_LONG', sizeMode: 'pct', size: num(ctx, 'sizePct'), reason: 'RSI ' + v.toFixed(1) + ' oversold' };
        if (ctx.positionSide === 'SHORT') return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: 'RSI oversold, cover short' };
      }
      if (v > overbought && ctx.positionSide !== 'FLAT') {
        return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: 'RSI ' + v.toFixed(1) + ' overbought' };
      }
      return null;
    },
    describe(): string {
      return 'RSI 反转：RSI(period) 低于 oversold 开多（空仓时）或平空，高于 overbought 平多。适合震荡行情。';
    },
  };
}
