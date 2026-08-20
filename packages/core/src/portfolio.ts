import type { Market, OrderSide, Position, PositionSide } from '@agentwin/shared';

/** 一次成交（已含滑点与手续费） */
export interface ExecutionFill {
  orderId: string;
  symbol: string;
  market: Market;
  side: OrderSide;
  qty: number;
  price: number;
  fee: number;
  feeAsset: string;
  tradedAt: number;
  /** 平仓部分已实现盈亏（开仓为 undefined） */
  realizedPnl?: number;
  positionSide: PositionSide;
}

export interface ExecuteOptions {
  /** 成交参考价（如 bar close / 最新价） */
  refPrice: number;
  /** 滑点 bps（万分之一单位，2 = 0.02%） */
  slippageBps?: number;
  /** 手续费率（taker，比例） */
  feeRate?: number;
  /** 是否允许反向开仓（合约允许，现货不允许） */
  allowReversal?: boolean;
  orderId?: string;
  tradedAt?: number;
}

export interface ExecuteResult {
  fill: ExecutionFill;
  position: Position | null;
  rejected?: string;
}

export interface PortfolioSnapshot {
  cash: number;
  positions: Position[];
}

/**
 * 模拟投资组合（现货 + USDT-M 合约）：
 * - 现货：仅 LONG；买入加仓、卖出减仓/平仓
 * - 合约：LONG/SHORT 双向；支持反向（平旧开新）
 * - cash 以 USDT 计；权益 = cash + 未实现盈亏
 */
export class SimulatedPortfolio {
  private positionsMap = new Map<string, Position>();
  private cashValue: number;
  private readonly market: Market;
  private readonly defaultFeeRate: number;
  private readonly defaultSlippageBps: number;

  constructor(initialCash: number, market: Market, defaultFeeRate = 0.001, defaultSlippageBps = 2) {
    this.cashValue = initialCash;
    this.market = market;
    this.defaultFeeRate = defaultFeeRate;
    this.defaultSlippageBps = defaultSlippageBps;
  }

  get cash(): number {
    return this.cashValue;
  }

  /** 直接调整现金（资金费/分红等外部现金流） */
  cashDelta(delta: number): void {
    this.cashValue += delta;
  }

  get positions(): Position[] {
    return [...this.positionsMap.values()];
  }

  positionFor(symbol: string): Position | null {
    return this.positionsMap.get(symbol + ':' + this.market) ?? null;
  }

  get equity(): number {
    let e = this.cashValue;
    for (const p of this.positionsMap.values()) e += p.unrealizedPnl;
    return e;
  }

  snapshot(): PortfolioSnapshot {
    return { cash: this.cashValue, positions: this.positions.map((p) => ({ ...p })) };
  }

  restore(snap: PortfolioSnapshot): void {
    this.cashValue = snap.cash;
    this.positionsMap.clear();
    for (const p of snap.positions) this.positionsMap.set(p.symbol + ':' + p.market, { ...p });
  }

  /** 用最新价标记市值 */
  markToMarket(markPrices: Record<string, number>): number {
    for (const p of this.positionsMap.values()) {
      const px = markPrices[p.symbol];
      if (px === undefined) continue;
      p.unrealizedPnl = this.unrealizedFor(p, px);
    }
    return this.equity;
  }

  private unrealizedFor(p: Position, price: number): number {
    if (p.quantity === 0) return 0;
    const dir = p.side === 'LONG' ? 1 : -1;
    return (price - p.avgEntryPrice) * p.quantity * dir;
  }

  /** 市价执行（模拟）：返回成交与更新后的持仓 */
  executeMarketOrder(symbol: string, side: OrderSide, qty: number, opts: ExecuteOptions): ExecuteResult {
    const feeRate = opts.feeRate ?? this.defaultFeeRate;
    const slippageBps = opts.slippageBps ?? this.defaultSlippageBps;
    const price = side === 'BUY'
      ? opts.refPrice * (1 + slippageBps / 10_000)
      : opts.refPrice * (1 - slippageBps / 10_000);
    const fee = price * qty * feeRate;
    const tradedAt = opts.tradedAt ?? Date.now();
    const orderId = opts.orderId ?? 'sim-' + Math.random().toString(36).slice(2);

    const key = symbol + ':' + this.market;
    const cur = this.positionsMap.get(key);

    if (this.market === 'SPOT') {
      if (side === 'BUY') {
        // 买入：需要现金
        const cost = price * qty + fee;
        if (cost > this.cashValue + 1e-9) {
          return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'LONG'), position: cur ?? null, rejected: 'insufficient_cash' };
        }
        this.cashValue -= cost;
        if (cur) {
          const totalQty = cur.quantity + qty;
          cur.avgEntryPrice = (cur.avgEntryPrice * cur.quantity + price * qty) / totalQty;
          cur.quantity = totalQty;
          cur.updatedAt = tradedAt;
        } else {
          const pos: Position = { accountId: '', symbol, market: this.market, side: 'LONG', quantity: qty, avgEntryPrice: price, unrealizedPnl: 0, realizedPnl: 0, updatedAt: tradedAt };
          this.positionsMap.set(key, pos);
          return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'LONG'), position: pos };
        }
      } else {
        // 卖出：需要持仓
        if (!cur || cur.quantity < qty - 1e-9) {
          return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'LONG'), position: cur ?? null, rejected: 'insufficient_position' };
        }
        const realized = (price - cur.avgEntryPrice) * qty - fee;
        cur.quantity -= qty;
        cur.realizedPnl += realized;
        this.cashValue += price * qty - fee;
        cur.updatedAt = tradedAt;
        const fill = this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'LONG', realized);
        if (cur.quantity < 1e-12) {
          this.positionsMap.delete(key);
          return { fill, position: null };
        }
        return { fill, position: cur };
      }
    } else {
      // USDT-M 合约：双向持仓
      const allowReversal = opts.allowReversal ?? false;
      if (side === 'BUY') {
        if (!cur || cur.side === 'LONG') {
          // 开多/加多
          if (cur) {
            const totalQty = cur.quantity + qty;
            cur.avgEntryPrice = (cur.avgEntryPrice * cur.quantity + price * qty) / totalQty;
            cur.quantity = totalQty;
            cur.updatedAt = tradedAt;
          } else {
            const pos: Position = { accountId: '', symbol, market: this.market, side: 'LONG', quantity: qty, avgEntryPrice: price, unrealizedPnl: 0, realizedPnl: 0, updatedAt: tradedAt };
            this.positionsMap.set(key, pos);
            return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'LONG'), position: pos };
          }
        } else if (cur.side === 'SHORT') {
          // 平空（部分/全部）或反向
          const closeQty = Math.min(qty, cur.quantity);
          const realized = (cur.avgEntryPrice - price) * closeQty - fee * (closeQty / qty);
          cur.quantity -= closeQty;
          cur.realizedPnl += realized;
          this.cashValue += realized;
          if (qty > closeQty) {
            if (!allowReversal) return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'SHORT'), position: cur, rejected: 'reversal_not_allowed' };
            const openQty = qty - closeQty;
            const pos: Position = { accountId: '', symbol, market: this.market, side: 'LONG', quantity: openQty, avgEntryPrice: price, unrealizedPnl: 0, realizedPnl: 0, updatedAt: tradedAt };
            pos.realizedPnl = 0;
            this.positionsMap.set(key, pos);
            const fill = this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'LONG', realized);
            return { fill, position: pos };
          }
          if (cur.quantity < 1e-12) {
            this.positionsMap.delete(key);
            return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'SHORT', realized), position: null };
          }
          cur.updatedAt = tradedAt;
          return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'SHORT', realized), position: cur };
        }
      } else {
        // SELL
        if (!cur || cur.side === 'SHORT') {
          if (cur) {
            const totalQty = cur.quantity + qty;
            cur.avgEntryPrice = (cur.avgEntryPrice * cur.quantity + price * qty) / totalQty;
            cur.quantity = totalQty;
            cur.updatedAt = tradedAt;
          } else {
            const pos: Position = { accountId: '', symbol, market: this.market, side: 'SHORT', quantity: qty, avgEntryPrice: price, unrealizedPnl: 0, realizedPnl: 0, updatedAt: tradedAt };
            this.positionsMap.set(key, pos);
            return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'SHORT'), position: pos };
          }
        } else if (cur.side === 'LONG') {
          const closeQty = Math.min(qty, cur.quantity);
          const realized = (price - cur.avgEntryPrice) * closeQty - fee * (closeQty / qty);
          cur.quantity -= closeQty;
          cur.realizedPnl += realized;
          this.cashValue += realized;
          if (qty > closeQty) {
            if (!allowReversal) return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'LONG'), position: cur, rejected: 'reversal_not_allowed' };
            const openQty = qty - closeQty;
            const pos: Position = { accountId: '', symbol, market: this.market, side: 'SHORT', quantity: openQty, avgEntryPrice: price, unrealizedPnl: 0, realizedPnl: 0, updatedAt: tradedAt };
            this.positionsMap.set(key, pos);
            const fill = this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'SHORT', realized);
            return { fill, position: pos };
          }
          if (cur.quantity < 1e-12) {
            this.positionsMap.delete(key);
            return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'LONG', realized), position: null };
          }
          cur.updatedAt = tradedAt;
          return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, 'LONG', realized), position: cur };
        }
      }
    }
    const pos = this.positionsMap.get(key) ?? null;
    return { fill: this.buildFill(symbol, side, qty, price, fee, tradedAt, orderId, pos?.side ?? 'LONG'), position: pos };
  }

  private buildFill(symbol: string, side: OrderSide, qty: number, price: number, fee: number, tradedAt: number, orderId: string, positionSide: PositionSide, realizedPnl?: number): ExecutionFill {
    return { orderId, symbol, market: this.market, side, qty, price, fee, feeAsset: 'USDT', tradedAt, positionSide, realizedPnl };
  }
}
