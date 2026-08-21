import { builtinRegistry } from '../registry.ts';
import { createMaCrossStrategy } from './maCross.ts';
import { createRsiStrategy } from './rsi.ts';
import { createBollingerStrategy } from './bollinger.ts';
import { createDcaStrategy } from './dca.ts';
import { createMacdTrendStrategy } from './macdTrend.ts';
import { createGridStrategy } from './grid.ts';
import { createCustomStrategy } from './custom.ts';

export function registerBuiltinStrategies(): void {
  const defs = [
    createMaCrossStrategy, createRsiStrategy, createBollingerStrategy,
    createDcaStrategy, createMacdTrendStrategy, createGridStrategy, createCustomStrategy,
  ];
  for (const factory of defs) {
    const s = factory();
    builtinRegistry.register(
      { id: s.id, name: s.name, description: s.description, paramSpecs: s.paramSpecs, marketSupport: ['SPOT', 'USDT_M'] },
      factory,
    );
  }
}
