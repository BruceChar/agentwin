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
  private factories = new Map<string, { factory: () => Strategy; hidden: boolean }>();

  /**
   * 注册策略。
   * @param opts.hidden=true 时为"兼容别名"：仍可 create/has（回测记录可复现），但不出现在 list()（策略中心不重复展示）。
   */
  register(meta: StrategyMeta, factory: () => Strategy, opts: { hidden?: boolean } = {}): void {
    this.factories.set(meta.id, { factory, hidden: opts.hidden === true });
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  /** 创建策略实例（无状态工厂；参数由调用方 normalize 后经 ctx 传入） */
  create(id: string): Strategy | null {
    const entry = this.factories.get(id);
    return entry ? entry.factory() : null;
  }

  meta(id: string): StrategyMeta | null {
    const entry = this.factories.get(id);
    if (!entry) return null;
    const s = entry.factory();
    return {
      id: s.id, name: s.name, description: s.description, paramSpecs: s.paramSpecs,
      marketSupport: ['SPOT', 'USDT_M'],
    };
  }

  /** 可供用户选择的策略（隐藏的兼容别名不返回） */
  list(): StrategyMeta[] {
    const out: StrategyMeta[] = [];
    for (const [id, entry] of this.factories) {
      if (entry.hidden) continue;
      const m = this.meta(id);
      if (m) out.push(m);
    }
    return out;
  }
}

export const builtinRegistry = new StrategyRegistry();
