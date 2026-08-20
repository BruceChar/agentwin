import type { Strategy, TradeIntent } from '../strategy.ts';
import { num } from '../strategy.ts';
import { bollinger } from '@agentwin/core';

export function createBollingerStrategy(): Strategy {
  return {
    id: 'bollinger',
    name: 'Bollinger Mean Reversion 布林均值回归',
    description: '价格跌破下轨开多，回升到中轨平仓。震荡型。',
    paramSpecs: [
      { name: 'period', type: 'number', default: 20, min: 5, max: 100, step: 1, description: '布林周期' },
      { name: 'mult', type: 'number', default: 2, min: 1, max: 4, step: 0.1, description: '标准差倍数' },
      { name: 'sizePct', type: 'number', default: 0.9, min: 0.05, max: 1, step: 0.05, description: '开仓比例' },
    ],
    onBar(ctx, bar, index): TradeIntent | null {
      const period = Math.floor(num(ctx, 'period'));
      const mult = num(ctx, 'mult');
      const closes = ctx.bars.map((b) => b.close);
      const b = bollinger(closes, period, mult);
      const lower = b.lower[index] ?? null;
      const mid = b.mid[index] ?? null;
      const price = bar.close;
      if (lower === null || mid === null) return null;
      if (price < lower && ctx.positionSide === 'FLAT') {
        return { action: 'OPEN_LONG', sizeMode: 'pct', size: num(ctx, 'sizePct'), reason: 'price below lower band' };
      }
      if (price >= mid && ctx.positionSide !== 'FLAT') {
        return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: 'price back to mid band' };
      }
      return null;
    },
    describe(): string {
      return '布林均值回归：价格跌破下轨开多，回到中轨平仓。参数：period 周期、mult 标准差倍数、sizePct 仓位。';
    },
  };
}
