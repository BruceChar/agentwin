import type { Strategy, TradeIntent } from '../strategy.ts';
import { num } from '../strategy.ts';
import { macd } from '@agentwin/core';

export function createMacdTrendStrategy(): Strategy {
  return {
    id: 'macd_trend',
    name: 'MACD Trend 趋势跟踪',
    description: 'MACD 柱由负转正开多，由正转负平仓。趋势型。',
    paramSpecs: [
      { name: 'fast', type: 'number', default: 12, min: 2, max: 50, step: 1, description: '快 EMA 周期' },
      { name: 'slow', type: 'number', default: 26, min: 5, max: 100, step: 1, description: '慢 EMA 周期' },
      { name: 'signal', type: 'number', default: 9, min: 2, max: 50, step: 1, description: '信号周期' },
      { name: 'sizePct', type: 'number', default: 0.95, min: 0.05, max: 1, step: 0.05, description: '开仓比例' },
    ],
    onBar(ctx, bar, index): TradeIntent | null {
      const closes = ctx.bars.map((b) => b.close);
      const m = macd(closes, Math.floor(num(ctx, 'fast')), Math.floor(num(ctx, 'slow')), Math.floor(num(ctx, 'signal')));
      const h0 = index > 0 ? (m.hist[index - 1] ?? null) : null;
      const h1 = m.hist[index] ?? null;
      if (h0 === null || h1 === null) return null;
      if (h0 <= 0 && h1 > 0) {
        if (ctx.positionSide !== 'FLAT') return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: 'MACD flip up' };
        return { action: 'OPEN_LONG', sizeMode: 'pct', size: num(ctx, 'sizePct'), reason: 'MACD histogram positive' };
      }
      if (h0 >= 0 && h1 < 0 && ctx.positionSide !== 'FLAT') {
        return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: 'MACD histogram negative' };
      }
      return null;
    },
    describe(): string {
      return 'MACD 趋势：histogram 由负转正开多，由正转负平仓。参数：fast/slow/signal 周期、sizePct 仓位。';
    },
  };
}
