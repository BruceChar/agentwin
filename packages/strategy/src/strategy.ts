import type { Candle, Interval, Market, StrategyParamValue } from '@agentwin/shared';

export interface StrategyParamSpec {
  name: string;
  type: 'number' | 'string' | 'boolean';
  default: StrategyParamValue;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
}

export interface StrategyContext {
  symbol: string;
  market: Market;
  interval: Interval;
  /** 已收盘的历史 K 线（含当前收盘 bar） */
  bars: Candle[];
  positionSide: 'LONG' | 'SHORT' | 'FLAT';
  positionQty: number;
  equity: number;
  cash: number;
  params: Record<string, StrategyParamValue>;
  /** 策略自用指标缓存 */
  indicators: Record<string, (number | null)[]>;
}

export type TradeAction = 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE' | 'FLAT';

export interface TradeIntent {
  action: TradeAction;
  /** 数量模式：pct = 按可用权益比例；qty = 固定数量 */
  sizeMode: 'pct' | 'qty';
  size: number;
  reason: string;
}

export interface Strategy {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly paramSpecs: StrategyParamSpec[];
  onBar(ctx: StrategyContext, bar: Candle, index: number): TradeIntent | null;
  /** 供 LLM 使用的策略说明（含参数含义与交易逻辑） */
  describe(): string;
}

export function defaultParams(strategy: Strategy): Record<string, StrategyParamValue> {
  const out: Record<string, StrategyParamValue> = {};
  for (const s of strategy.paramSpecs) out[s.name] = s.default;
  return out;
}

function coerce(spec: StrategyParamSpec, v: StrategyParamValue): StrategyParamValue {
  if (spec.type === 'number') {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (!Number.isFinite(n)) return spec.default;
    if (spec.min !== undefined && n < spec.min) return spec.min;
    if (spec.max !== undefined && n > spec.max) return spec.max;
    return n;
  }
  if (spec.type === 'boolean') return v === true || v === 'true' || v === 1 || v === '1';
  return String(v);
}

/** 只保留 spec 内的参数并做类型/范围校正 */
export function normalizeParams(strategy: Strategy, params: Record<string, StrategyParamValue> = {}): Record<string, StrategyParamValue> {
  const out = defaultParams(strategy);
  for (const [k, v] of Object.entries(params)) {
    const spec = strategy.paramSpecs.find((p) => p.name === k);
    if (!spec) continue;
    out[k] = coerce(spec, v);
  }
  return out;
}

export function num(ctx: StrategyContext, name: string): number {
  return Number(ctx.params[name] ?? 0);
}

export function bool(ctx: StrategyContext, name: string): boolean {
  return ctx.params[name] === true || ctx.params[name] === 'true';
}
