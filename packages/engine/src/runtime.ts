import type { Candle, Interval, Market, StrategyParamValue } from '@agentwin/shared';
import { INTERVAL_MS } from '@agentwin/shared';
import { ema, last, macd, rsi } from '@agentwin/core';
import { normalizeParams, type Strategy, type TradeAction, type TradeIntent } from '@agentwin/strategy';
import type { MarketDataProvider, Unsubscribe } from '@agentwin/market';

/**
 * 策略实时运行时（StrategyRuntime）。
 *
 * 与回测 / paper trading 不同，运行时不负责下单，只负责"在后台持续更新指标并发出事件"：
 * - 独立的生命周期：start() 后作为后台任务持续运行，与 HTTP 请求周期解耦；
 * - 更新频率 granularity（可设置，默认取 K 线周期）：
 *     - `bar`（默认）：每根 K 线**收盘**更新一次，频率 = 配置周期（如 1h → 每小时一次）；
 *     - `intra`：盘中更新，按 `throttleMs` 节流（缺省按周期推导 `clamp(周期/20, 1s, 30s)`）；
 * - 事件只在"更新点"产生（未收盘 K 线的秒级推送不会刷屏）：
 *     - `candle`：最新 K 线（与 indicator 同一更新点）；
 *     - `indicator`：指标快照（EMA/MACD/RSI）+ 策略信号；
 *     - 另有 start / stop / error。
 * - 每个事件通过 `onEvent` 通知下游；
 * - 同时输出标准指标快照（EMA/MACD/RSI），下游可直接画到 K 线图上。
 *
 * 说明（关于"单独的线程"）：运行时是独立的后台异步任务，不再占用请求处理路径；
 * Node 单线程事件循环下，指标计算量很小（几百根 K 线），无需 worker_thread。
 * 若将来某个策略计算变成 CPU 瓶颈，可将本类放入 worker_threads，事件接口保持不变。
 */

export type RuntimeGranularity = 'bar' | 'intra';

export interface StrategyRuntimeOptions {
  /** 运行时 id；缺省由 strategy/symbol/market/interval 推导 */
  id?: string;
  strategyId: string;
  symbol: string;
  market: Market;
  interval: Interval;
  /** 更新粒度：bar=仅收盘（默认）/ intra=盘中节流更新 */
  granularity?: RuntimeGranularity;
  /** intra 节流毫秒；缺省按周期推导（clamp(interval/20, 1s, 30s)） */
  throttleMs?: number;
  /** 预热 K 线数量，默认 300 */
  warmupLimit?: number;
  /** 策略参数（会被 normalize） */
  params?: Record<string, StrategyParamValue>;
}

export interface StrategyRuntimeDeps {
  marketData: MarketDataProvider;
  strategyFactory: (id: string) => Strategy | null;
  onEvent?: (e: StrategyRuntimeEvent) => void;
  /** 可注入时钟（测试用） */
  now?: () => number;
}

/** 标准指标快照（供下游/图表直接使用） */
export interface IndicatorSnapshot {
  fast: number;
  slow: number;
  signal: number;
  emaFast: number | null;
  emaSlow: number | null;
  /** MACD 线 */
  dif: number | null;
  /** 信号线 */
  dea: number | null;
  /** MACD 柱 */
  hist: number | null;
  rsi: number | null;
}

/** 策略信号（原始 TradeIntent 的只读视图） */
export interface RuntimeSignal {
  action: TradeAction;
  sizeMode: TradeIntent['sizeMode'];
  size: number;
  reason: string;
}

export interface StrategyRuntimeEventBase {
  runtimeId: string;
  seq: number;
  at: number;
  symbol: string;
  market: Market;
  interval: Interval;
  strategyId: string;
}

export type StrategyRuntimeEvent =
  | (StrategyRuntimeEventBase & { type: 'start' })
  | (StrategyRuntimeEventBase & { type: 'stop' })
  /** K 线更新：closed=false 为未收盘（盘中）bar，true 为已收盘 bar */
  | (StrategyRuntimeEventBase & { type: 'candle'; candle: Candle; closed: boolean })
  /** 指标事件：每次按粒度重算后发出；signal 为策略本次给出的意图（可能为 null） */
  | (StrategyRuntimeEventBase & { type: 'indicator'; candle: Candle; closed: boolean; indicators: IndicatorSnapshot; signal: RuntimeSignal | null })
  | (StrategyRuntimeEventBase & { type: 'error'; message: string });

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export interface RuntimeStatus {
  id: string;
  running: boolean;
  strategyId: string;
  symbol: string;
  market: Market;
  interval: Interval;
  granularity: RuntimeGranularity;
  throttleMs: number;
  bars: number;
  lastBarOpenTime: number;
  lastPrice: number;
  lastEventAt: number;
  startedAt: number;
  seq: number;
}

const MIN_THROTTLE_MS = 1_000;
const MAX_THROTTLE_MS = 30_000;

/** 由周期推导默认的盘中节流：约周期的 1/20，clamp 到 1s–30s */
export function defaultThrottleMs(interval: Interval): number {
  const step = INTERVAL_MS[interval] ?? 60_000;
  return Math.min(MAX_THROTTLE_MS, Math.max(MIN_THROTTLE_MS, Math.floor(step / 20)));
}

export class StrategyRuntime {
  readonly id: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly market: Market;
  readonly interval: Interval;
  readonly granularity: RuntimeGranularity;
  readonly throttleMs: number;

  private readonly strategy: Strategy;
  private readonly params: Record<string, StrategyParamValue>;
  private readonly deps: StrategyRuntimeDeps;
  private readonly warmupLimit: number;
  private readonly now: () => number;

  private bars: Candle[] = [];
  private running = false;
  private unsub: Unsubscribe | null = null;
  private seq = 0;
  private startedAt = 0;
  private lastEventAt = 0;
  private lastRecomputeAt = 0;
  private lastPrice = 0;
  private lastBarOpenTime = 0;

  constructor(opts: StrategyRuntimeOptions, deps: StrategyRuntimeDeps) {
    const strategy = deps.strategyFactory(opts.strategyId);
    if (!strategy) throw new Error('unknown strategy: ' + opts.strategyId);
    this.strategy = strategy;
    this.strategyId = opts.strategyId;
    this.symbol = opts.symbol.toUpperCase();
    this.market = opts.market;
    this.interval = opts.interval;
    this.granularity = opts.granularity === 'intra' ? 'intra' : 'bar';
    this.throttleMs = opts.throttleMs && opts.throttleMs > 0 ? Math.floor(opts.throttleMs) : defaultThrottleMs(opts.interval);
    this.warmupLimit = opts.warmupLimit ?? 300;
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.params = normalizeParams(strategy, opts.params ?? {});
    this.id = opts.id ?? [opts.strategyId, this.symbol, opts.market, opts.interval].join(':');
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** 启动后台运行时：预热 → 订阅实时 K 线 → 持续更新并发出事件 */
  async start(): Promise<void> {
    if (this.running) return;
    const warmup = await this.deps.marketData.getKlines({
      symbol: this.symbol, market: this.market, interval: this.interval, limit: this.warmupLimit,
    });
    this.bars = warmup.slice(-Math.max(this.warmupLimit, 1));
    const lastBar = this.bars[this.bars.length - 1];
    this.lastPrice = lastBar?.close ?? 0;
    this.lastBarOpenTime = lastBar?.openTime ?? 0;

    this.unsub = await this.deps.marketData.subscribe(
      { symbol: this.symbol, market: this.market, stream: 'kline', interval: this.interval },
      (ev) => {
        if (ev.candle) this.onKline(ev.candle);
      },
    );

    this.running = true;
    this.startedAt = this.now();
    this.emit({ type: 'start' });
    // 首帧指标快照：让下游立即可用（以最后一根预热 K 线为基准）
    if (lastBar) this.recompute(lastBar, lastBar.closeTime < this.now());
  }

  /** 停止运行时：退订行情，释放后台任务 */
  async stop(): Promise<void> {
    if (!this.running) return;
    try { this.unsub?.(); } catch { /* ignore */ }
    this.unsub = null;
    this.running = false;
    this.emit({ type: 'stop' });
  }

  status(): RuntimeStatus {
    return {
      id: this.id, running: this.running,
      strategyId: this.strategyId, symbol: this.symbol, market: this.market, interval: this.interval,
      granularity: this.granularity, throttleMs: this.throttleMs,
      bars: this.bars.length, lastBarOpenTime: this.lastBarOpenTime, lastPrice: this.lastPrice,
      lastEventAt: this.lastEventAt, startedAt: this.startedAt, seq: this.seq,
    };
  }

  /** 处理一条实时 K 线（含未收盘 bar） */
  private onKline(candle: Candle): void {
    const now = this.now();
    const closed = candle.closeTime < now;

    // 维护 K 线缓冲：同 openTime 覆盖，新 openTime 追加
    const lastBar = this.bars[this.bars.length - 1];
    if (!lastBar || candle.openTime > lastBar.openTime) this.bars.push(candle);
    else if (candle.openTime === lastBar.openTime) this.bars[this.bars.length - 1] = candle;
    else return; // 过期的旧 bar（乱序/回放）忽略
    if (this.bars.length > 1000) this.bars = this.bars.slice(-1000);
    this.lastPrice = candle.close;
    this.lastBarOpenTime = candle.openTime;

    // 更新频率：bar = 每根 K 线收盘（= 周期）；intra = 收盘必更新 + 盘中按 throttleMs 节流。
    // 未到更新点时不产生任何事件——否则未收盘 K 线的秒级推送会把事件流刷爆。
    const due = this.granularity === 'bar'
      ? closed
      : closed || now - this.lastRecomputeAt >= this.throttleMs;
    if (!due) return;

    this.emit({ type: 'candle', candle, closed });
    this.recompute(candle, closed);
  }

  /** 用当前 bars 调用策略并发出 indicator 事件（策略异常记 error，不中断运行时） */
  private recompute(candle: Candle, closed: boolean): void {
    this.lastRecomputeAt = this.now();
    const idx = this.bars.length - 1;
    const ctx = {
      symbol: this.symbol, market: this.market, interval: this.interval,
      bars: this.bars,
      positionSide: 'FLAT' as const, positionQty: 0,
      equity: 0, cash: 0,
      params: this.params, indicators: {},
    };
    let intent: TradeIntent | null = null;
    try {
      intent = this.strategy.onBar(ctx, candle, idx);
    } catch (e) {
      this.emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    this.emit({
      type: 'indicator',
      candle, closed,
      indicators: this.snapshot(),
      signal: intent && intent.action !== 'FLAT'
        ? { action: intent.action, sizeMode: intent.sizeMode, size: intent.size, reason: intent.reason }
        : null,
    });
  }

  /** 标准指标快照（EMA/MACD/RSI），供下游画图 */
  private snapshot(): IndicatorSnapshot {
    const closes = this.bars.map((b) => b.close);
    const fast = paramNum(this.params, 'fast', 12);
    const slow = paramNum(this.params, 'slow', 26);
    const sig = paramNum(this.params, 'signal', 9);
    const m = macd(closes, fast, slow, sig);
    return {
      fast, slow, signal: sig,
      emaFast: last(ema(closes, fast)),
      emaSlow: last(ema(closes, slow)),
      dif: last(m.macd),
      dea: last(m.signal),
      hist: last(m.hist),
      rsi: last(rsi(closes, 14)),
    };
  }

  private emit(e: DistributiveOmit<StrategyRuntimeEvent, 'runtimeId' | 'seq' | 'at' | 'symbol' | 'market' | 'interval' | 'strategyId'>): void {
    this.seq += 1;
    this.lastEventAt = this.now();
    const event = {
      ...e,
      runtimeId: this.id, seq: this.seq, at: this.lastEventAt,
      symbol: this.symbol, market: this.market, interval: this.interval, strategyId: this.strategyId,
    } as StrategyRuntimeEvent;
    this.deps.onEvent?.(event);
  }
}

function paramNum(params: Record<string, StrategyParamValue>, key: string, dflt: number): number {
  const v = params[key];
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}
