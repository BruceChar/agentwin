import type { Strategy, TradeIntent } from '../strategy.ts';
import { num } from '../strategy.ts';

interface GridState {
  anchor: number;
  nextBuy: number;
  nextSell: number;
  initialized: boolean;
}

/**
 * 网格策略：围绕锚点（首次建仓价）按固定百分比网格低买高卖。
 * 有内部状态（每实例一份），回测/实盘各创建独立实例。
 */
export function createGridStrategy(): Strategy {
  const state: GridState = { anchor: 0, nextBuy: 0, nextSell: 0, initialized: false };

  return {
    id: 'grid',
    name: 'Grid 网格',
    description: '以锚点为中心按固定网格间距低买高卖，适合震荡行情。',
    paramSpecs: [
      { name: 'gridPct', type: 'number', default: 1.5, min: 0.2, max: 10, step: 0.1, description: '网格间距（%）' },
      { name: 'sizePct', type: 'number', default: 0.2, min: 0.01, max: 1, step: 0.01, description: '每格投入权益比例' },
      { name: 'maxGrids', type: 'number', default: 10, min: 2, max: 50, step: 1, description: '最大网格数' },
    ],
    onBar(ctx, bar, index): TradeIntent | null {
      const pct = num(ctx, 'gridPct') / 100;
      const size = num(ctx, 'sizePct');
      const maxGrids = Math.floor(num(ctx, 'maxGrids'));
      const price = bar.close;
      if (!state.initialized) {
        state.anchor = price;
        state.nextBuy = price * (1 - pct);
        state.nextSell = price * (1 + pct);
        state.initialized = true;
        return null;
      }
      if (ctx.positionSide === 'FLAT') {
        if (price <= state.nextBuy) {
          state.nextSell = state.nextBuy * (1 + pct);
          state.nextBuy = state.nextBuy * (1 - pct);
          return { action: 'OPEN_LONG', sizeMode: 'pct', size, reason: 'grid buy at ' + price.toFixed(2) };
        }
        return null;
      }
      // 有持仓：涨到卖出网格就平仓，重新锚定
      if (price >= state.nextSell) {
        state.anchor = price;
        state.nextBuy = price * (1 - pct);
        state.nextSell = price * (1 + pct);
        return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: 'grid sell at ' + price.toFixed(2) };
      }
      // 深跌：加仓网格（最多 maxGrids 层）——简化处理：不再加仓，仅保留单层
      return null;
    },
    describe(): string {
      return '网格：以锚点为中心，价格跌破买入网格（间距 gridPct%）时开多，涨回卖出网格时平仓。maxGrids 限制最大层级（当前实现单层）。';
    },
  };
}
