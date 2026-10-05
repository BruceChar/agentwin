import type { Strategy, StrategyContext, TradeIntent } from '../strategy.ts';
import { bool, num } from '../strategy.ts';
import { ema, macd } from '@agentwin/core';

/**
 * MACD 量价势能衰竭反转（Momentum Exhaustion Reversal）
 *
 * 核心思想：相邻两个同向 MACD 波形（hist 同号区段）之间，检测"相对势能"衰减，
 * 并要求成交量不缩（相当或更大）作为硬性确认：
 * - 看跌：量峰创新高/动能没跟上（或新波峰明显弱于前波峰）+ 量能不缩 → 多头动能衰竭 → 变盘下跌
 * - 看涨：负谷变浅（空头势能衰减）+ 量能不缩 → 空头动能衰竭 → 变盘上涨
 *
 * 锚定方式：
 * - anchor=volume（默认）：以区段内量峰 bar 的 hist（Hv）为新区段势能
 * - anchor=hist：以区段 hist 极值（P/N）为新区段势能
 *
 * 信号确认时机：区段结束后的第一根异号 bar 确认，延迟一根执行（避免追在极值/量峰尖上）。
 * 同一区段天然只触发一次（仅在"刚结束"的那根确认 bar 被评估）。
 *
 * 实现说明（引擎限制）：
 * - 引擎每根 bar 新建 ctx.indicators（不可跨 bar 缓存）→ 每次全量重算 macd（与 macd_trend 一致）
 * - ctx 无持仓成本 → 用闭包记录入场价，自行实现 TP/SL（风险优先于新信号）
 * - USDT-M 引擎 allowReversal=true 支持同 bar 反手（持多遇看跌 → OPEN_SHORT = 平多+开空，size=1 全额转向）
 * - SPOT 引擎忽略 OPEN_SHORT → 看跌信号在 SPOT 仅平多、不反手开空
 */

/** 区段：hist 连续同号的一段已结束 K 线区间 */
interface Zone {
  sign: 1 | -1; // 1=正区段（hist>0），-1=负区段（hist<0）
  start: number; // 起始 bar index（含）
  end: number; // 结束 bar index（含）
  peak: number; // 正区段 max(hist) / 负区段 min(hist)（负值）
  volPeakIdx: number; // 量峰 bar index（并列取更靠近 end，保证确定性）
  vol: number; // 区段量能（量峰邻域 ±volWindow 均值，越界按区段内截断；volWindow=0 取单根量）
  hv: number; // 量峰处 hist 值
}

/** hist 符号；hist=0 延续上一符号（浮点下极少见，避免产生碎区段） */
function signOf(h: number | null | undefined, last: 1 | -1 | null): 1 | -1 | null {
  if (h == null) return null;
  if (h > 0) return 1;
  if (h < 0) return -1;
  return last ?? 1;
}

/** 区段量能：量峰邻域 ±window 根的成交量均值；越界按区段 [start..end] 截断，不跨异向区段 */
function zoneVol(vols: number[], peakIdx: number, start: number, end: number, window: number): number {
  if (window <= 0) return vols[peakIdx] ?? 0;
  const lo = Math.max(start, peakIdx - window);
  const hi = Math.min(end, peakIdx + window);
  let sum = 0;
  let n = 0;
  for (let i = lo; i <= hi; i++) {
    sum += vols[i] ?? 0;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * 扫描 hist 截至 limit 的已结束区段序列（进行中的区段不返回，未结束不参与信号）。
 * 区段结束点：hist 符号翻转处（翻转前一根为该区段 end）。
 */
function scanZones(H: (number | null)[], vols: number[], limit: number, volWindow: number): Zone[] {
  const zones: Zone[] = [];
  let start = -1;
  let sign: 1 | -1 | null = null;
  let peak = 0;
  let volPeakIdx = -1;
  let volPeakVol = -1;
  let hv = 0;

  const begin = (i: number, s: 1 | -1) => {
    start = i;
    sign = s;
    peak = H[i] ?? 0;
    volPeakIdx = i;
    volPeakVol = vols[i] ?? 0;
    hv = H[i] ?? 0;
  };
  const flush = (end: number) => {
    if (start < 0 || sign === null) return;
    zones.push({ sign, start, end, peak, volPeakIdx, vol: zoneVol(vols, volPeakIdx, start, end, volWindow), hv });
    start = -1;
    sign = null;
  };

  for (let i = 0; i <= limit; i++) {
    const s = signOf(H[i], sign);
    if (s === null) {
      if (start >= 0) flush(i - 1); // warmup 中间断裂（理论不发生），强制结束当前区段
      continue;
    }
    if (start < 0) {
      begin(i, s);
      continue;
    }
    if (s !== sign) {
      flush(i - 1);
      begin(i, s);
      continue;
    }
    // 同符号延续：更新极值与量峰（量峰并列取更靠近 end，即后出现者胜）
    const h = H[i] ?? 0;
    if ((sign === 1 && h > peak) || (sign === -1 && h < peak)) peak = h;
    const v = vols[i] ?? 0;
    if (v >= volPeakVol) {
      volPeakVol = v;
      volPeakIdx = i;
      hv = h;
    }
  }
  // 进行中的区段不 flush：未确认结束，不参与信号
  return zones;
}

/** 信号检测：返回 { dir, detail } 或 null。衰减 + 量能确认 + minAbsEnergy + strictPeakDecay */
function detectSignal(
  z: Zone,
  zp: Zone | null,
  anchor: string,
  decayRatio: number,
  volConfirmRatio: number,
  minAbsEnergy: number,
  strictPeakDecay: boolean,
): { dir: 'bull' | 'bear'; detail: string } | null {
  if (!zp || zp.sign !== z.sign) return null;
  const abs = (n: number) => Math.abs(n);

  if (z.sign === 1) {
    // 正区段对 → 看跌候选
    const newE = anchor === 'volume' ? z.hv : z.peak;
    const oldE = zp.peak;
    const weak = newE <= oldE * decayRatio;
    let ok = weak;
    if (anchor === 'volume' && strictPeakDecay) ok = ok && z.peak <= zp.peak * decayRatio;
    if (minAbsEnergy > 0) ok = ok && newE >= minAbsEnergy;
    const volOk = z.vol >= zp.vol * volConfirmRatio;
    if (!ok || !volOk) return null;
    const ratio = oldE > 0 ? newE / oldE : 0;
    const vRatio = zp.vol > 0 ? z.vol / zp.vol : 0;
    return {
      dir: 'bear',
      detail: 'bear: anchor=' + anchor + ' 新势能 ' + round2(newE) + ' ≤ 前 ' + round2(oldE) + '×' + decayRatio +
        '（比 ' + round2(ratio) + '）; 量 ' + round2(z.vol) + ' ≥ 前 ' + round2(zp.vol) + '×' + volConfirmRatio +
        '（比 ' + round2(vRatio) + '）; zPrev[' + zp.start + '..' + zp.end + ']→z[' + z.start + '..' + z.end + ']',
    };
  }
  // 负区段对 → 看涨候选
  const newE = anchor === 'volume' ? abs(z.hv) : abs(z.peak);
  const oldE = abs(zp.peak);
  const weak = newE <= oldE * decayRatio;
  let ok = weak;
  if (anchor === 'volume' && strictPeakDecay) ok = ok && abs(z.peak) <= oldE * decayRatio;
  if (minAbsEnergy > 0) ok = ok && newE >= minAbsEnergy;
  const volOk = z.vol >= zp.vol * volConfirmRatio;
  if (!ok || !volOk) return null;
  const ratio = oldE > 0 ? newE / oldE : 0;
  const vRatio = zp.vol > 0 ? z.vol / zp.vol : 0;
  return {
    dir: 'bull',
    detail: 'bull: anchor=' + anchor + ' 新势能 ' + round2(newE) + ' ≤ 前 ' + round2(oldE) + '×' + decayRatio +
      '（比 ' + round2(ratio) + '）; 量 ' + round2(z.vol) + ' ≥ 前 ' + round2(zp.vol) + '×' + volConfirmRatio +
      '（比 ' + round2(vRatio) + '）; zPrev[' + zp.start + '..' + zp.end + ']→z[' + z.start + '..' + z.end + ']',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 趋势过滤：ema=价格相对 EMA；zero=MACD 线相对零轴（看涨需上方，看跌需下方） */
function trendOk(dir: 'bull' | 'bear', filter: string, ctx: StrategyContext, closes: number[], macdLine: (number | null)[], emaPeriod: number): boolean {
  const lastClose = closes[closes.length - 1];
  if (lastClose === undefined) return true;
  if (filter === 'ema') {
    const e = ema(closes, emaPeriod);
    const v = e[e.length - 1];
    if (v == null) return true; // warmup 未完成，不拦截
    return dir === 'bull' ? lastClose > v : lastClose < v;
  }
  if (filter === 'zero') {
    const ml = macdLine[macdLine.length - 1];
    if (ml == null) return true;
    return dir === 'bull' ? ml > 0 : ml < 0;
  }
  return true;
}

/**
 * 按文档 sideMode 逻辑生成意图（延迟一根执行）。
 * - both：允许反手；long：只多，看跌仅平多；short：只空，看涨仅平空。
 * - USDT-M 反手用 size=1 全额转向（引擎 allowReversal 同 bar 平旧+开新，需开仓量 > 持仓量）；
 *   SPOT 引擎忽略 OPEN_SHORT，看跌信号仅平多。
 */
function reversalIntent(dir: 'bull' | 'bear', ctx: StrategyContext, sizePct: number, sideMode: string): TradeIntent | null {
  const side = ctx.positionSide;
  const usdtM = ctx.market === 'USDT_M';

  if (dir === 'bear') {
    if (sideMode === 'long') {
      return side === 'LONG'
        ? { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看跌信号（long-only）平多' }
        : null;
    }
    if (sideMode === 'short') {
      if (side === 'FLAT') return { action: 'OPEN_SHORT', sizeMode: 'pct', size: sizePct, reason: '看跌信号（short-only）开空' };
      if (side === 'LONG') return usdtM ? { action: 'OPEN_SHORT', sizeMode: 'pct', size: 1, reason: '看跌信号（short-only）平多反手' } : { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看跌信号（short-only）平多' };
      return null;
    }
    // both
    if (side === 'LONG') {
      return usdtM
        ? { action: 'OPEN_SHORT', sizeMode: 'pct', size: 1, reason: '看跌反手：动能衰竭+量能确认，平多开空' }
        : { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看跌信号（SPOT）平多' };
    }
    if (side === 'FLAT') {
      return usdtM
        ? { action: 'OPEN_SHORT', sizeMode: 'pct', size: sizePct, reason: '看跌信号：动能衰竭+量能确认，开空' }
        : null; // SPOT 无法做空
    }
    return null;
  }

  // bull
  if (sideMode === 'short') {
    return side === 'SHORT'
      ? { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看涨信号（short-only）平空' }
      : null;
  }
  if (sideMode === 'long') {
    if (side === 'FLAT') return { action: 'OPEN_LONG', sizeMode: 'pct', size: sizePct, reason: '看涨信号（long-only）开多' };
    if (side === 'SHORT') return usdtM ? { action: 'OPEN_LONG', sizeMode: 'pct', size: 1, reason: '看涨信号（long-only）平空反手' } : { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看涨信号（long-only）平空' };
    return null;
  }
  // both
  if (side === 'SHORT') {
    return usdtM
      ? { action: 'OPEN_LONG', sizeMode: 'pct', size: 1, reason: '看涨反手：空头衰竭+量能承接，平空开多' }
      : { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '看涨信号平空' };
  }
  if (side === 'FLAT') return { action: 'OPEN_LONG', sizeMode: 'pct', size: sizePct, reason: '看涨信号：空头衰竭+量能承接，开多' };
  return null;
}

export function createMacdEnergyReversalStrategy(): Strategy {
  // 实例级闭包状态：一次回测/paper 运行内有效
  let pending: { dir: 'bull' | 'bear'; detail: string } | null = null; // 已确认、延迟一根执行的信号
  let entryPrice = 0; // 当前持仓入场价（引擎 ctx 不含持仓成本，自行记录用于 TP/SL）
  let warnedFastSlow = false;

  return {
    id: 'macd_energy_reversal',
    name: 'MACD 量价势能衰竭反转',
    description: '相邻同向 MACD 波形势能衰减 + 成交量不缩确认，捕捉放量滞涨/放量抗跌后的变盘反转。反转型。',
    paramSpecs: [
      { name: 'fast', type: 'number', default: 12, min: 2, max: 50, step: 1, description: 'MACD 快 EMA 周期' },
      { name: 'slow', type: 'number', default: 26, min: 5, max: 100, step: 1, description: 'MACD 慢 EMA 周期' },
      { name: 'signal', type: 'number', default: 9, min: 2, max: 50, step: 1, description: 'MACD 信号周期' },
      { name: 'anchor', type: 'string', default: 'volume', description: '锚定：volume=量峰处势能（默认）/ hist=区段极值' },
      { name: 'decayRatio', type: 'number', default: 0.5, min: 0.1, max: 0.9, step: 0.05, description: '偏离程度：新势能 ≤ 前势能 × 该比例（0.3 更严 / 0.7 更宽）' },
      { name: 'volConfirmRatio', type: 'number', default: 0.9, min: 0.1, max: 1.5, step: 0.05, description: '量能确认：新量 ≥ 前量 × 该比例（0.9 允许略缩 / 1.1 要求真放量）' },
      { name: 'volWindow', type: 'number', default: 3, min: 0, max: 10, step: 1, description: '量峰邻域 ±N 根平均量（0=单根量）' },
      { name: 'minAbsEnergy', type: 'number', default: 0, min: 0, max: 1e9, step: 0.01, description: '最小势能绝对值过滤（0=关闭；须低于典型旧势能×decayRatio，否则无信号）' },
      { name: 'strictPeakDecay', type: 'boolean', default: false, description: '仅 anchor=volume 生效：额外要求新区段 hist 极值也衰减' },
      { name: 'sideMode', type: 'string', default: 'both', description: 'both=双向可反手 / long=仅多 / short=仅空' },
      { name: 'trendFilter', type: 'string', default: 'off', description: 'off=关闭 / ema=价格相对 EMA / zero=MACD 线相对零轴' },
      { name: 'trendEmaPeriod', type: 'number', default: 50, min: 5, max: 200, step: 1, description: '仅 trendFilter=ema 生效' },
      { name: 'sizePct', type: 'number', default: 0.9, min: 0.05, max: 1, step: 0.05, description: '开仓比例（按可用权益）' },
      { name: 'takeProfitPct', type: 'number', default: 0.05, min: 0, max: 1, step: 0.01, description: '浮盈达该比例平仓（0=关闭）' },
      { name: 'stopLossPct', type: 'number', default: 0.03, min: 0, max: 1, step: 0.01, description: '浮亏达该比例平仓（0=关闭）' },
    ],
    onBar(ctx, bar, index): TradeIntent | null {
      const fast = Math.floor(num(ctx, 'fast'));
      const slow = Math.floor(num(ctx, 'slow'));
      const signalP = Math.floor(num(ctx, 'signal'));
      if (!warnedFastSlow && fast >= slow) {
        console.warn('[macd_energy_reversal] 建议 fast < slow，当前 fast=' + fast + ' slow=' + slow);
        warnedFastSlow = true;
      }
      const closes = ctx.bars.map((b) => b.close);
      const vols = ctx.bars.map((b) => b.volume);
      const m = macd(closes, fast, slow, signalP);
      const H = m.hist;
      const anchor = String(ctx.params['anchor'] ?? 'volume');
      const decayRatio = num(ctx, 'decayRatio');
      const volConfirmRatio = num(ctx, 'volConfirmRatio');
      const volWindow = Math.floor(num(ctx, 'volWindow'));
      const minAbsEnergy = num(ctx, 'minAbsEnergy');
      const strictPeakDecay = bool(ctx, 'strictPeakDecay');
      const sideMode = String(ctx.params['sideMode'] ?? 'both');
      const trendFilter = String(ctx.params['trendFilter'] ?? 'off');
      const trendEmaPeriod = Math.floor(num(ctx, 'trendEmaPeriod'));
      const sizePct = num(ctx, 'sizePct');
      const tp = num(ctx, 'takeProfitPct');
      const sl = num(ctx, 'stopLossPct');

      // 1) TP/SL：风险优先（先于已确认信号与新区段信号；引擎按 bar.close 成交，与闭包记录入场价一致）
      if (entryPrice > 0 && ctx.positionSide !== 'FLAT') {
        const pnlPct = ctx.positionSide === 'LONG'
          ? (bar.close - entryPrice) / entryPrice
          : (entryPrice - bar.close) / entryPrice;
        if (tp > 0 && pnlPct >= tp) {
          entryPrice = 0;
          return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '止盈 ' + (pnlPct * 100).toFixed(2) + '%' };
        }
        if (sl > 0 && pnlPct <= -sl) {
          entryPrice = 0;
          return { action: 'CLOSE', sizeMode: 'pct', size: 1, reason: '止损 ' + (pnlPct * 100).toFixed(2) + '%' };
        }
      }

      // 2) 执行已确认待执行的信号（上一根确认，本根执行，避免追在极值/量峰尖上）
      if (pending) {
        const p = pending;
        pending = null;
        const intent = reversalIntent(p.dir, ctx, sizePct, sideMode);
        if (intent) {
          if (intent.action === 'OPEN_LONG' || intent.action === 'OPEN_SHORT') entryPrice = bar.close;
          else if (intent.action === 'CLOSE') entryPrice = 0;
          return { ...intent, reason: intent.reason + '（' + p.detail + '）' };
        }
      }

      // 3) 新信号检测：当前 bar 与上一根 hist 异号 → 上一区段 [start..i-1] 刚结束（天然去重：每区段只在该确认 bar 评估一次）
      const hi = H[index] ?? null;
      const hi1 = index > 0 ? (H[index - 1] ?? null) : null;
      if (hi !== null && hi1 !== null && signOf(hi, null) !== signOf(hi1, null)) {
        // limit 取 index（含当前 bar）：扫描到当前翻转点，才把 [start..i-1] 作为已结束区段输出
        const zones = scanZones(H, vols, index, volWindow);
        const z = zones[zones.length - 1];
        if (z && z.end === index - 1) {
          const zp = zones.length >= 3 ? zones[zones.length - 3]! : null; // 最近同向已结束区段（中间隔一个异向区段）
          const hit = detectSignal(z, zp, anchor, decayRatio, volConfirmRatio, minAbsEnergy, strictPeakDecay);
          if (hit && trendOk(hit.dir, trendFilter, ctx, closes, m.macd, trendEmaPeriod)) {
            pending = { dir: hit.dir, detail: hit.detail }; // 延迟一根执行
          }
        }
      }
      return null;
    },
    describe(): string {
      return 'MACD 量价势能衰竭反转：比较相邻同向 MACD 波形的相对势能（anchor=volume 量峰处 hist / hist 区段极值），' +
        '新势能 ≤ 前势能 × decayRatio 且量能 ≥ 前量 × volConfirmRatio 时判定动能衰竭：正波峰衰减+放量 → 看跌反手/开空，' +
        '负波谷变浅+放量 → 看涨反手/开多。信号在区段结束后的异号 bar 确认、下一根执行；可选 strictPeakDecay（要求新区段极值也衰减）、' +
        'trendFilter（ema/zero 趋势过滤）、sideMode（both/long/short）、takeProfitPct/stopLossPct。反转型，建议 1h+ 周期、震荡/拐点行情使用。';
    },
  };
}

/** 兼容别名（文档：若已有引用/回测记录使用 macd_energy，可经此工厂创建同一策略） */
export function createMacdEnergyStrategy(): Strategy {
  return createMacdEnergyReversalStrategy();
}
