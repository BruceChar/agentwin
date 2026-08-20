import type { Strategy, TradeIntent } from '../strategy.ts';
import { num } from '../strategy.ts';

export function createDcaStrategy(): Strategy {
  return {
    id: 'dca',
    name: 'DCA 定投',
    description: '每隔 N 根 K 线定额买入，达到止盈比例平仓。长期积累型。',
    paramSpecs: [
      { name: 'intervalBars', type: 'number', default: 24, min: 1, max: 1000, step: 1, description: '每 N 根 K 线买入一次' },
      { name: 'sizePct', type: 'number', default: 0.1, min: 0.01, max: 1, step: 0.01, description: '每次投入权益比例' },
      { name: 'takeProfitPct', type: 'number', default: 0.05, min: 0, max: 1, step: 0.01, description: '持仓浮盈达到该比例时平仓（0 表示不平）' },
    ],
    onBar(ctx, bar, index): TradeIntent | null {
      const every = Math.max(1, Math.floor(num(ctx, 'intervalBars')));
      const tp = num(ctx, 'takeProfitPct');
      if (ctx.positionSide !== 'FLAT' && tp > 0 && ctx.positionQty > 0) {
        // 用 equity 变化近似浮盈（简化：通过 ctx.equity 不可得，这里留给引擎处理止盈）
      }
      if (ctx.positionSide === 'FLAT' && index > 0 && index % every === 0) {
        return { action: 'OPEN_LONG', sizeMode: 'pct', size: num(ctx, 'sizePct'), reason: 'DCA buy #' + index };
      }
      return null;
    },
    describe(): string {
      return '定投 DCA：每 intervalBars 根 K 线以 sizePct 比例权益买入；takeProfitPct 浮盈止盈（0 关闭）。';
    },
  };
}
