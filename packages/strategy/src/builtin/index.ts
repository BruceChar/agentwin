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
  // 兼容别名：macd_energy → macd_energy_reversal（文档要求两个 ID 均可创建/选择）
  // registry.meta() 返回工厂实例的 id（忽略 meta.id），故别名用包装工厂固定实例 id
  builtinRegistry.register(
    { id: 'macd_energy', name: 'MACD 量价势能衰竭反转', description: createMacdEnergyReversalStrategy().description + '（兼容别名，同 macd_energy_reversal）', paramSpecs: createMacdEnergyReversalStrategy().paramSpecs, marketSupport: ['SPOT', 'USDT_M'] },
    () => ({ ...createMacdEnergyReversalStrategy(), id: 'macd_energy' }),
  );
}
