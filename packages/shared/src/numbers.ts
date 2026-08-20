// ================= 数值工具 =================

export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || step <= 0) return value;
  const n = Math.round(value / step) * step;
  // 消除浮点尾巴
  return Number(n.toPrecision(15));
}

export function roundToPrecision(value: number, precision: number): number {
  if (!Number.isFinite(value)) return value;
  const p = Math.max(0, precision);
  return Number(value.toFixed(p));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function notional(price: number, qty: number): number {
  return price * qty;
}

export function feeFor(notionalValue: number, rate: number): number {
  return notionalValue * rate;
}

/** 现货：平仓后已实现盈亏 = (卖价 - 买价) * 数量 - 买卖手续费 */
export function realizedPnlSpot(
  buyPrice: number,
  sellPrice: number,
  qty: number,
  buyFee: number,
  sellFee: number,
): number {
  return (sellPrice - buyPrice) * qty - buyFee - sellFee;
}

/** 合约：按方向计算已实现盈亏（LONG: (exit-entry)*qty；SHORT: (entry-exit)*qty），扣手续费与资金费 */
export function realizedPnlFutures(
  side: 'LONG' | 'SHORT',
  entryPrice: number,
  exitPrice: number,
  qty: number,
  fees: number,
  fundingPaid = 0,
): number {
  const dir = side === 'LONG' ? 1 : -1;
  return (exitPrice - entryPrice) * qty * dir - fees - fundingPaid;
}

export function pnlPct(pnl: number, capital: number): number {
  if (capital === 0) return 0;
  return pnl / capital;
}

/** 根据 stepSize 与最小数量规范数量（向下取整到 step 的倍数） */
export function sanitizeQty(qty: number, stepSize: number, minQty: number): number {
  let q = roundToStep(qty, stepSize);
  if (q < minQty) q = 0;
  return q;
}

export function formatMoney(value: number, currency = 'USDT'): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}${currency} ${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
