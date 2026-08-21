import type { MarketDataProvider } from '@agentwin/market';
import type { TradeJournal } from '@agentwin/shared';
import { atr, ema, rsi } from '@agentwin/core';
import { INTERVAL_MS } from '@agentwin/shared';

export interface AutoFillResult {
  record: Partial<TradeJournal>;
  notes: string[];
}

/**
 * 交易日志自动提取：
 * - 开/平仓价 + 方向 + 数量 → 盈亏 / 费用(估算) / 净收益 / 盈亏% / R倍数
 * - 开平仓时间 → 持仓时长
 * - 行情（真实数据）→ 开仓点 RSI/ATR/EMA 指标、波动率、持仓期间 MFE/MAE
 */
export class JournalAutoFill {
  private readonly marketData: MarketDataProvider;

  constructor(marketData: MarketDataProvider) {
    this.marketData = marketData;
  }

  async fill(input: Partial<TradeJournal>): Promise<AutoFillResult> {
    const notes: string[] = [];
    const rec: Partial<TradeJournal> = { ...input };

    // 1) 盈亏
    if (rec.actualEntry !== undefined && rec.actualExit !== undefined && rec.direction && rec.actualQty && rec.actualQty > 0) {
      const dir = rec.direction === 'LONG' ? 1 : -1;
      const gross = (rec.actualExit - rec.actualEntry) * rec.actualQty * dir;
      const estFees = rec.fees ?? (Math.abs(rec.actualEntry * rec.actualQty) + Math.abs(rec.actualExit * rec.actualQty)) * 0.001;
      rec.pnl = gross;
      rec.fees = estFees;
      rec.netPnl = gross - estFees;
      const notional = Math.abs(rec.actualEntry * rec.actualQty);
      rec.pnlPct = notional > 0 ? (rec.netPnl / notional) * 100 : undefined;
      if (rec.plannedRiskAmount && rec.plannedRiskAmount > 0) {
        rec.rMultiple = rec.netPnl / rec.plannedRiskAmount;
      }
      notes.push('盈亏=开平仓价差×数量（' + rec.direction + '），费用按 0.1%×双边 估算' + (rec.fees === estFees ? '' : '（已填实际费用）'));
    }

    // 2) 持仓时长
    if (rec.openTime && rec.closeTime && rec.closeTime > rec.openTime) {
      rec.holdingDuration = formatDuration(rec.closeTime - rec.openTime);
    }

    // 3) 行情提取：指标 + MFE/MAE
    const symbol = rec.symbol?.toUpperCase();
    if (symbol) {
      try {
        const market = (rec.market === 'U本位合约' || rec.market === '币本位合约') ? 'USDT_M' : 'SPOT';
        const end = rec.closeTime ?? Date.now();
        const startRaw = rec.openTime ?? end;
        const span = Math.max(end - startRaw, INTERVAL_MS['5m']);
        const interval = span < 3 * INTERVAL_MS['1h'] ? '5m' : span < 2 * INTERVAL_MS['1d'] ? '15m' : '1h';
        const start = startRaw - 100 * INTERVAL_MS[interval];
        const candles = await this.marketData.getKlines({ symbol, market, interval, startTime: start, endTime: end });
        if (candles.length > 25) {
          const entryIdx = rec.openTime ? candles.findIndex((c) => c.openTime >= rec.openTime!) : candles.length - 1;
          const idx = entryIdx > 0 ? entryIdx : candles.length - 1;
          const slice = candles.slice(0, idx + 1);
          const closes = slice.map((c) => c.close);
          const rsiV = lastNum(rsi(closes, 14));
          const atrV = lastNum(atr(slice, 14));
          const e20 = lastNum(ema(closes, 20));
          const e50 = lastNum(ema(closes, 50));
          const px = closes[closes.length - 1];
          if (px !== undefined) {
            rec.indicators = {
              rsi14: rsiV !== undefined ? Math.round(rsiV * 10) / 10 : null,
              atr14Pct: atrV !== undefined ? Math.round((atrV / px) * 10000) / 100 : null,
              ema20: e20 !== undefined ? Math.round(e20 * 100) / 100 : null,
              ema50: e50 !== undefined ? Math.round(e50 * 100) / 100 : null,
              emaTrend: e20 !== undefined && e50 !== undefined ? (e20 > e50 ? '多头' : '空头') : null,
            };
            rec.volatility = atrV !== undefined ? 'ATR ' + Math.round((atrV / px) * 10000) / 100 + '%（' + interval + '）' : undefined;
            notes.push('已提取开仓点指标 RSI/ATR/EMA（' + interval + '）');
          }
          // MFE/MAE
          if (rec.actualEntry !== undefined) {
            const inCandles = candles.filter((c) =>
              (!rec.openTime || c.openTime >= rec.openTime!) && (!rec.closeTime || c.openTime <= rec.closeTime!),
            );
            if (inCandles.length > 0) {
              const maxHigh = Math.max(...inCandles.map((c) => c.high));
              const minLow = Math.min(...inCandles.map((c) => c.low));
              rec.mfe = rec.direction === 'LONG'
                ? Math.max(0, maxHigh - rec.actualEntry)
                : Math.max(0, rec.actualEntry - minLow);
              rec.mae = rec.direction === 'LONG'
                ? Math.max(0, rec.actualEntry - minLow)
                : Math.max(0, maxHigh - rec.actualEntry);
              notes.push('已从持仓期间行情计算 MFE/MAE');
            }
          }
        } else {
          notes.push('行情数据不足，未提取指标');
        }
      } catch (e) {
        notes.push('行情提取失败（' + (e instanceof Error ? e.message : String(e)) + '），可手动填写');
      }
    }
    return { record: rec, notes };
  }
}

function lastNum(arr: (number | null)[]): number | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return undefined;
}

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return '不足 1 分钟';
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return h + ' 小时' + (rm ? ' ' + rm + ' 分钟' : '');
  const d = Math.floor(h / 24);
  return d + ' 天 ' + (h % 24) + ' 小时';
}
