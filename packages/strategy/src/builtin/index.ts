import { builtinRegistry } from '../registry.ts';
import { createMaCrossStrategy } from './maCross.ts';
import { createRsiStrategy } from './rsi.ts';
import { createBollingerStrategy } from './bollinger.ts';
import { createDcaStrategy } from './dca.ts';
import { createMacdTrendStrategy } from './macdTrend.ts';
import { createGridStrategy } from './grid.ts';
import { createCustomStrategy } from './custom.ts';
import { createMacdEnergyReversalStrategy } from './macdEnergyReversal.ts';

export function registerBuiltinStrategies(): void {
  const defs = [
    createMaCrossStrategy, createRsiStrategy, createBollingerStrategy,
    createDcaStrategy, createMacdTrendStrategy, createGridStrategy, createCustomStrategy,
    createMacdEnergyReversalStrategy,
  ];
  for (const factory of defs) {
    const s = factory();
    builtinRegistry.register(
      { id: s.id, name: s.name, description: s.description, paramSpecs: s.paramSpecs, marketSupport: ['SPOT', 'USDT_M'] },
      factory,
    );
  }
  // 兼容别名：macd_energy → macd_energy_reversal（两个 ID 均可创建，历史回测记录可复现）
  // hidden=true：不出现在策略列表，避免策略中心重复展示；create/has 仍可用。
  const aliasMeta = createMacdEnergyReversalStrategy();
  builtinRegistry.register(
    { id: 'macd_energy', name: aliasMeta.name, description: aliasMeta.description + '（兼容别名，同 macd_energy_reversal）', paramSpecs: aliasMeta.paramSpecs, marketSupport: ['SPOT', 'USDT_M'] },
    () => ({ ...createMacdEnergyReversalStrategy(), id: 'macd_energy' }),
    { hidden: true },
  );
}
