import type { Market } from '@agentwin/shared';
import type { Strategy, StrategyParamSpec } from './strategy.ts';

export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  paramSpecs: StrategyParamSpec[];
  marketSupport: Market[];
}

/** 策略注册表：内置策略在此登记，可按需扩展 */
export class StrategyRegistry {
  private factories = new Map<string, () => Strategy>();

  register(meta: StrategyMeta, factory: () => Strategy): void {
    this.factories.set(meta.id, factory);
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  /** 创建策略实例（无状态工厂；参数由调用方 normalize 后经 ctx 传入） */
  create(id: string): Strategy | null {
    const factory = this.factories.get(id);
    return factory ? factory() : null;
  }

  meta(id: string): StrategyMeta | null {
    const factory = this.factories.get(id);
    if (!factory) return null;
    const s = factory();
    return {
      id: s.id, name: s.name, description: s.description, paramSpecs: s.paramSpecs,
      marketSupport: ['SPOT', 'USDT_M'],
    };
  }

  list(): StrategyMeta[] {
    const out: StrategyMeta[] = [];
    for (const id of this.factories.keys()) {
      const m = this.meta(id);
      if (m) out.push(m);
    }
    return out;
  }
}

export const builtinRegistry = new StrategyRegistry();
