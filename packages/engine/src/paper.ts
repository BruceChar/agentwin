import { randomUUID } from 'node:crypto';
import type { Candle, Interval, Market, Order, StrategyParamValue, SymbolInfo, Trade } from '@agentwin/shared';
import { SimulatedPortfolio } from '@agentwin/core';
import { normalizeParams, type Strategy } from '@agentwin/strategy';
import type { StorageAdapter } from '@agentwin/db';
import type { MarketDataProvider, Unsubscribe } from '@agentwin/market';

export interface PaperEngineOptions {
  accountId: string;
  /** 内置策略 id（如 ma_cross） */
  strategyId: string;
  /** 可选：持久化策略配置 id，用于加载已保存的参数 */
  configId?: string;
  market: Market;
  symbol: string;
  interval: Interval;
  feeRate?: number;
  slippageBps?: number;
  initialCapital?: number;
}

export interface PaperEngineDeps {
  storage: StorageAdapter;
  marketData: MarketDataProvider;
  strategyFactory: (id: string) => Strategy | null;
  /** 事件回调（用于 API 推送/日志） */
  onEvent?: (e: PaperEvent) => void;
}

export type PaperEvent =
  | { type: 'start' }
  | { type: 'bar'; candle: Candle }
  | { type: 'order'; order: Order }
  | { type: 'trade'; trade: Trade }
  | { type: 'equity'; equity: number; cash: number; timestamp: number }
  | { type: 'stop' }
  | { type: 'error'; message: string };

export interface PaperStatus {
  running: boolean;
  accountId: string;
  strategyId: string;
  symbol: string;
  market: Market;
  interval: Interval;
  lastBarOpenTime: number;
  lastPrice: number;
  equity: number;
  cash: number;
  positions: { symbol: string; side: string; quantity: number; avgEntryPrice: number; unrealizedPnl: number }[];
  updatedAt: number;
}

/**
 * Paper Trading 引擎：订阅 Binance 真实行情（REST 预热 + WebSocket 实时），
 * 在本地模拟账户中执行策略成交（手续费/滑点模拟），**绝不向 Binance 下发真实订单**。
 * 所有状态落库（kline/订单/成交/持仓/权益），重启可恢复。
 */
export class PaperTradingEngine {
  private runningFlag = false;
  private unsubscribers: Unsubscribe[] = [];
  private portfolio: SimulatedPortfolio;
  private bars: Candle[] = [];
  private lastPrice = 0;
  private lastBarOpenTime = 0;
  private lastProcessedOpenTime = 0;
  private strategy: Strategy;
  private params: Record<string, StrategyParamValue>;
  private symbolInfo: SymbolInfo | null = null;
  private opts: PaperEngineOptions;
  private deps: PaperEngineDeps;

  constructor(opts: PaperEngineOptions, deps: PaperEngineDeps) {
    this.opts = { feeRate: 0.001, slippageBps: 2, initialCapital: 10_000, ...opts };
    this.deps = deps;
    const s = deps.strategyFactory(opts.strategyId);
    if (!s) throw new Error('unknown strategy: ' + opts.strategyId);
    this.strategy = s;
    this.params = normalizeParams(s, {});
    this.portfolio = new SimulatedPortfolio(this.opts.initialCapital ?? 10_000, opts.market, this.opts.feeRate, this.opts.slippageBps);
  }

  get running(): boolean {
    return this.runningFlag;
  }

  async start(): Promise<void> {
    if (this.runningFlag) return;
    const { storage, marketData } = this.deps;
    const o = this.opts;

    // 恢复账户
    const account = await storage.getAccount(o.accountId);
    if (!account) throw new Error('account not found: ' + o.accountId);

    // 恢复策略参数
    const config = await storage.getStrategy(o.configId ?? o.strategyId);
    if (config) this.params = normalizeParams(this.strategy, config.parameters);

    // 恢复组合：现金 + 持仓
    const bals = await storage.getBalances(o.accountId);
    const usdt = bals.find((b) => b.asset === 'USDT');
    const cash = usdt?.free ?? this.opts.initialCapital ?? 10_000;
    this.portfolio = new SimulatedPortfolio(cash, o.market, this.opts.feeRate, this.opts.slippageBps);
    const positions = (await storage.getPositions(o.accountId)).filter((p) => p.symbol === o.symbol);
    if (positions.length > 0) this.portfolio.restore({ cash, positions });

    // 获取预热 K 线（真实数据）
    const warmup = await marketData.getKlines({ symbol: o.symbol, market: o.market, interval: o.interval, limit: 300 });
    this.bars = warmup;
    const now = Date.now();
    const stored = await storage.getKlines({ symbol: o.symbol, market: o.market, interval: o.interval, limit: 1 });
    const storedMax = stored.length > 0 ? stored[0]!.openTime : 0;

    // 停机期间错过的已收盘 K 线回放
    for (const bar of warmup) {
      if (bar.closeTime < now && bar.openTime > storedMax) {
        await this.processBar(bar);
      }
    }
    const closed = warmup.filter((b) => b.closeTime < now);
    this.lastBarOpenTime = closed.length > 0 ? closed[closed.length - 1]!.openTime : (warmup[0]?.openTime ?? 0);
    this.lastProcessedOpenTime = this.lastBarOpenTime;
    if (warmup.length > 0) this.lastPrice = warmup[warmup.length - 1]!.close;

    // 订阅实时行情
    this.unsubscribers.push(await marketData.subscribe(
      { symbol: o.symbol, market: o.market, stream: 'kline', interval: o.interval },
      (ev) => {
        if (ev.candle) void this.onKline(ev.candle);
      },
    ));
    try {
      this.unsubscribers.push(await marketData.subscribe(
        { symbol: o.symbol, market: o.market, stream: 'bookTicker' },
        (ev) => {
          if (ev.bookTicker) {
            this.lastPrice = (ev.bookTicker.bidPrice + ev.bookTicker.askPrice) / 2;
            this.markToMarket();
          }
        },
      ));
    } catch {
      // bookTicker 不可用时忽略
    }

    this.runningFlag = true;
    this.deps.onEvent?.({ type: 'start' });
    await this.snapshotEquity();
  }

  async stop(): Promise<void> {
    if (!this.runningFlag) return;
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.runningFlag = false;
    await this.snapshotEquity();
    this.deps.onEvent?.({ type: 'stop' });
  }

  async onKline(candle: Candle): Promise<void> {
    const o = this.opts;
    const now = Date.now();
    // 只处理已收盘 K 线（防未来函数）
    if (candle.closeTime >= now) return;
    await this.processBar(candle);
  }

  private async processBar(candle: Candle): Promise<void> {
    const { storage } = this.deps;
    const o = this.opts;
    if (candle.openTime === this.lastProcessedOpenTime) return; // 幂等

    // 更新 bars 缓冲
    const last = this.bars[this.bars.length - 1];
    if (!last || candle.openTime > last.openTime) this.bars.push(candle);
    else if (candle.openTime === last.openTime) this.bars[this.bars.length - 1] = candle;
    if (this.bars.length > 500) this.bars = this.bars.slice(-500);

    // 持久化 K 线
    await storage.upsertKlines([{ ...candle, symbol: o.symbol, market: o.market, interval: o.interval }]);
    this.lastPrice = candle.close;
    this.lastBarOpenTime = candle.openTime;

    // 策略决策
    const idx = this.bars.length - 1;
    const pos = this.portfolio.positionFor(o.symbol);
    const ctx = {
      symbol: o.symbol, market: o.market, interval: o.interval,
      bars: this.bars,
      positionSide: (pos?.side ?? 'FLAT') as 'LONG' | 'SHORT' | 'FLAT',
      positionQty: pos?.quantity ?? 0,
      equity: this.portfolio.equity, cash: this.portfolio.cash,
      params: this.params, indicators: {},
    };
    let intent: ReturnType<Strategy['onBar']> = null;
    try {
      intent = this.strategy.onBar(ctx, candle, idx);
    } catch (e) {
      this.deps.onEvent?.({ type: 'error', message: String(e instanceof Error ? e.message : e) });
      return;
    }

    if (intent && intent.action !== 'FLAT') {
      await this.executeIntent(intent.action, intent.size, candle);
    }

    await this.snapshotEquity();
    this.deps.onEvent?.({ type: 'bar', candle });
    this.lastProcessedOpenTime = candle.openTime;
  }

  private async executeIntent(action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE' | 'FLAT', size: number, bar: Candle): Promise<void> {
    const { storage } = this.deps;
    const o = this.opts;
    const pos = this.portfolio.positionFor(o.symbol);
    let side: 'BUY' | 'SELL' | null = null;
    let qty = 0;

    if (action === 'CLOSE' && pos) {
      side = 'SELL';
      qty = pos.quantity;
    } else if (action === 'OPEN_LONG') {
      side = 'BUY';
      qty = this.sizing(size, bar.close, 'LONG');
    } else if (action === 'OPEN_SHORT' && o.market === 'USDT_M') {
      side = 'SELL';
      qty = this.sizing(size, bar.close, 'SHORT');
    }
    if (!side || qty <= 0) return;

    qty = this.sanitizeQty(qty);
    if (qty <= 0) return;

    // 创建订单（模拟）
    const order = await storage.createOrder({
      accountId: o.accountId, strategyId: o.strategyId, symbol: o.symbol, market: o.market,
      side, type: 'MARKET', price: bar.close, quantity: qty, createdAt: bar.closeTime,
    });

    const result = this.portfolio.executeMarketOrder(o.symbol, side, qty, {
      refPrice: bar.close, orderId: order.id, tradedAt: bar.closeTime, allowReversal: true,
    });

    if (result.rejected) {
      await storage.patchOrder(order.id, { status: 'REJECTED', meta: { reason: result.rejected } });
      return;
    }

    const fill = result.fill;
    const filled = await storage.patchOrder(order.id, {
      status: 'FILLED', filledQty: fill.qty, avgFillPrice: fill.price, fee: fill.fee, feeAsset: fill.feeAsset,
    });
    if (filled) this.deps.onEvent?.({ type: 'order', order: filled });

    const trade: Trade = {
      id: randomUUID(), orderId: order.id, accountId: o.accountId, strategyId: o.strategyId,
      symbol: o.symbol, market: o.market, side: fill.side, qty: fill.qty, price: fill.price,
      fee: fill.fee, feeAsset: fill.feeAsset, tradedAt: fill.tradedAt,
      pnl: fill.realizedPnl, realizedPnl: fill.realizedPnl,
    };
    await storage.createTrade(trade);
    this.deps.onEvent?.({ type: 'trade', trade });

    // 持仓落库
    if (result.position) {
      await storage.upsertPosition({ ...result.position, accountId: o.accountId });
    } else {
      await storage.deletePosition(o.accountId, o.symbol, o.market);
    }
    await storage.setBalance(o.accountId, 'USDT', this.portfolio.cash, 0);
  }

  private sizing(sizePct: number, price: number, _side: 'LONG' | 'SHORT'): number {
    if (price <= 0) return 0;
    if (this.opts.market === 'SPOT') return (this.portfolio.cash * Math.min(sizePct, 1)) / price;
    return (this.portfolio.equity * Math.min(sizePct, 1)) / price;
  }

  private sanitizeQty(qty: number): number {
    if (this.symbolInfo) {
      const step = this.symbolInfo.stepSize > 0 ? this.symbolInfo.stepSize : 1e-8;
      const n = Math.floor(qty / step) * step;
      const fixed = Number(n.toPrecision(15));
      return fixed >= (this.symbolInfo.minQty ?? 0) ? fixed : 0;
    }
    return qty;
  }

  private markToMarket(): void {
    this.portfolio.markToMarket({ [this.opts.symbol]: this.lastPrice });
  }

  private async snapshotEquity(): Promise<void> {
    const { storage } = this.deps;
    this.markToMarket();
    const unrealized = this.portfolio.positions.reduce((a, p) => a + p.unrealizedPnl, 0);
    await storage.appendEquity({
      accountId: this.opts.accountId, timestamp: Date.now(),
      equity: this.portfolio.equity, cash: this.portfolio.cash, unrealizedPnl: unrealized,
    });
    for (const p of this.portfolio.positions) {
      await storage.upsertPosition({ ...p, accountId: this.opts.accountId });
    }
    await storage.setBalance(this.opts.accountId, 'USDT', this.portfolio.cash, 0);
    this.deps.onEvent?.({ type: 'equity', equity: this.portfolio.equity, cash: this.portfolio.cash, timestamp: Date.now() });
  }

  status(): PaperStatus {
    return {
      running: this.runningFlag,
      accountId: this.opts.accountId, strategyId: this.opts.strategyId,
      symbol: this.opts.symbol, market: this.opts.market, interval: this.opts.interval,
      lastBarOpenTime: this.lastBarOpenTime, lastPrice: this.lastPrice,
      equity: this.portfolio.equity, cash: this.portfolio.cash,
      positions: this.portfolio.positions.map((p) => ({
        symbol: p.symbol, side: p.side, quantity: p.quantity,
        avgEntryPrice: p.avgEntryPrice, unrealizedPnl: p.unrealizedPnl,
      })),
      updatedAt: Date.now(),
    };
  }
}
