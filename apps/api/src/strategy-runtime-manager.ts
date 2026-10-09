import type { Interval, Market, StrategyParamValue } from '@agentwin/shared';
import { StrategyRuntime, type RuntimeGranularity, type RuntimeStatus, type StrategyRuntimeEvent } from '@agentwin/engine';
import { builtinRegistry } from '@agentwin/strategy';
import type { AppServices } from './services.ts';

export interface RuntimeStartRequest {
  id?: string;
  strategyId: string;
  symbol: string;
  market: Market;
  interval: Interval;
  granularity?: RuntimeGranularity;
  throttleMs?: number;
  warmupLimit?: number;
  params?: Record<string, StrategyParamValue>;
}

export interface RuntimeEventsQuery {
  runtimeId?: string;
  /** 只返回 seq > since 的事件（增量消费） */
  since?: number;
  limit?: number;
}

/**
 * 策略实时运行时管理器：每个"策略实例（策略 × 品种 × 市场 × 周期）"对应一个后台运行的
 * StrategyRuntime；统一维护事件环形缓冲，并广播给下游订阅者（WebSocket / SSE / 轮询）。
 */
export class StrategyRuntimeManager {
  private readonly services: AppServices;
  private readonly runtimes = new Map<string, StrategyRuntime>();
  private readonly buffers = new Map<string, StrategyRuntimeEvent[]>();
  private readonly listeners = new Set<(e: StrategyRuntimeEvent) => void>();
  private readonly maxBuffer: number;

  constructor(services: AppServices, opts: { maxBuffer?: number } = {}) {
    this.services = services;
    this.maxBuffer = opts.maxBuffer ?? 500;
  }

  get size(): number {
    return this.runtimes.size;
  }

  /** 启动一个策略运行时（后台持续更新，与请求周期解耦） */
  async start(req: RuntimeStartRequest): Promise<RuntimeStatus> {
    const rt = new StrategyRuntime(
      {
        id: req.id, strategyId: req.strategyId, symbol: req.symbol, market: req.market, interval: req.interval,
        granularity: req.granularity, throttleMs: req.throttleMs, warmupLimit: req.warmupLimit, params: req.params,
      },
      {
        marketData: this.services.marketData,
        strategyFactory: (id) => builtinRegistry.create(id),
        onEvent: (e) => this.dispatch(e),
      },
    );
    const existing = this.runtimes.get(rt.id);
    if (existing?.isRunning) throw new Error('runtime already running: ' + rt.id);
    this.runtimes.set(rt.id, rt);
    if (!this.buffers.has(rt.id)) this.buffers.set(rt.id, []);
    try {
      await rt.start();
    } catch (e) {
      this.runtimes.delete(rt.id);
      throw e;
    }
    return rt.status();
  }

  /** 停止运行时；返回停止前的状态（找不到则返回 null） */
  async stop(id: string): Promise<RuntimeStatus | null> {
    const rt = this.runtimes.get(id);
    if (!rt) return null;
    await rt.stop();
    this.runtimes.delete(id);
    return rt.status(); // 停止后的状态（running=false）
  }

  list(): RuntimeStatus[] {
    return [...this.runtimes.values()].map((r) => r.status());
  }

  status(id: string): RuntimeStatus | null {
    return this.runtimes.get(id)?.status() ?? null;
  }

  /** 读取事件环形缓冲（下游轮询/断线重放） */
  events(q: RuntimeEventsQuery = {}): StrategyRuntimeEvent[] {
    const since = q.since ?? 0;
    const limit = Math.max(1, Math.min(q.limit ?? 200, 2000));
    let all: StrategyRuntimeEvent[];
    if (q.runtimeId) {
      all = (this.buffers.get(q.runtimeId) ?? []).filter((e) => e.seq > since);
    } else {
      all = [];
      for (const buf of this.buffers.values()) for (const e of buf) if (e.seq > since) all.push(e);
      all.sort((a, b) => a.at - b.at || a.seq - b.seq);
    }
    return all.slice(-limit);
  }

  /** 订阅全部运行时的实时事件（WebSocket 广播 / 外部下游）；返回退订函数 */
  subscribe(fn: (e: StrategyRuntimeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.runtimes.keys()].map((id) => this.stop(id)));
  }

  private dispatch(e: StrategyRuntimeEvent): void {
    const buf = this.buffers.get(e.runtimeId) ?? [];
    buf.push(e);
    if (buf.length > this.maxBuffer) buf.splice(0, buf.length - this.maxBuffer);
    this.buffers.set(e.runtimeId, buf);
    for (const fn of this.listeners) {
      try { fn(e); } catch { /* 单个订阅者异常不影响其他订阅者 */ }
    }
  }
}
