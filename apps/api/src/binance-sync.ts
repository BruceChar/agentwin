import type { Account, Market, Trade } from '@agentwin/shared';
import type { StorageAdapter } from '@agentwin/db';
import type { BinanceRest, FuturesAccountInfo, MarketDataProvider, MyTradeRow, ProxyConfig, SpotAccountInfo } from '@agentwin/market';

export const DEFAULT_SYNC_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT'];

export interface SyncReport {
  ok: boolean;
  accountId: string;
  balancesUpserted: number;
  futuresPositions: number;
  tradesSynced: number;
  tradesSkipped: number;
  equityAppended: boolean;
  message?: string;
  at: number;
}

export interface BinanceStatus {
  configured: boolean;
  /** 是否读到 BINANCE_API_KEY */
  hasKey: boolean;
  /** 是否读到 BINANCE_API_SECRET */
  hasSecret: boolean;
  /** 缺失的配置项（如 ["BINANCE_API_SECRET"]） */
  missing: string[];
  reachable: boolean;
  message?: string;
  spotHost: string;
  futuresHost: string;
  /** 当前代理配置（BINANCE_PROXY / BINANCE_PROXY_URL / HTTPS_PROXY） */
  proxy: ProxyConfig;
  /** 最近一次同步结果（含失败原因，前端可直接展示） */
  lastSync?: { at: number; ok: boolean; message?: string; balancesUpserted: number; futuresPositions: number; tradesSynced: number } | null;
}

/**
 * 真实账户同步：把 Binance 私有接口（余额/合约持仓/成交/权益）拉入本地存储，
 * 复用同一套 StorageAdapter，使「账户/交易/盈亏」看板直接展示真实数据。
 * 全程只读，绝不通过本模块下单。
 */
export class BinanceAccountSync {
  private readonly storage: StorageAdapter;
  private readonly rest: BinanceRest;
  private readonly marketData: MarketDataProvider;
  /** 最近一次同步结果（诊断用） */
  private lastReport: SyncReport | null = null;

  constructor(storage: StorageAdapter, rest: BinanceRest, marketData: MarketDataProvider) {
    this.storage = storage;
    this.rest = rest;
    this.marketData = marketData;
  }

  get lastSync(): SyncReport | null {
    return this.lastReport;
  }

  async ensureRealAccount(): Promise<Account> {
    const existing = (await this.storage.listAccounts()).find((a) => a.type === 'real');
    if (existing) return existing;
    return this.storage.createAccount({ name: 'binance-real', type: 'real', meta: { source: 'binance' } });
  }

  /** 私有接口连通性（key 只对 api.binance.com / fapi.binance.com 有效） */
  async status(): Promise<BinanceStatus> {
    const hasKey = Boolean(process.env.BINANCE_API_KEY?.trim());
    const hasSecret = Boolean(process.env.BINANCE_API_SECRET?.trim());
    const missing: string[] = [];
    if (!hasKey) missing.push('BINANCE_API_KEY');
    if (!hasSecret) missing.push('BINANCE_API_SECRET');
    const configured = hasKey && hasSecret;
    let reachable = false;
    let message: string | undefined;
    if (configured) {
      try {
        reachable = await this.rest.reachable();
        if (!reachable) message = 'api.binance.com 不可达（DNS 污染或网络受限）';
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
    }
    const lastSync = this.lastReport
      ? { at: this.lastReport.at, ok: this.lastReport.ok, message: this.lastReport.message, balancesUpserted: this.lastReport.balancesUpserted, futuresPositions: this.lastReport.futuresPositions, tradesSynced: this.lastReport.tradesSynced }
      : null;
    return { configured, hasKey, hasSecret, missing, reachable, message, spotHost: 'api.binance.com', futuresHost: 'fapi.binance.com', proxy: this.rest.proxy, lastSync };
  }

  /** 串行化同步：启动自动同步与手动/重置同步不并发，避免写入竞态 */
  private syncTail: Promise<void> = Promise.resolve();

  /** 在同步锁内执行任意操作（排队串行） */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.syncTail.then(fn);
    this.syncTail = run.then(() => undefined, () => undefined);
    return run;
  }

  async syncAll(opts: { symbols?: string[]; limitPerSymbol?: number; forceTrades?: boolean } = {}): Promise<SyncReport> {
    return this.exclusive(() => this.syncAllInternal(opts));
  }

  /** 原子重置并全量重同步：清库 + 拉取历史在同一把锁内完成，杜绝与启动同步并发 */
  async resetAndFullSync(opts: { symbols?: string[]; limitPerSymbol?: number; forceTrades?: boolean } = {}): Promise<SyncReport> {
    return this.exclusive(async () => {
      await this.storage.wipeAll();
      return this.syncAllInternal(opts);
    });
  }

  /** 全量同步：现货 + 全仓杠杆 + 逐仓杠杆 + U本位 + 币本位（余额/持仓/成交/权益） */
  private async syncAllInternal(opts: { symbols?: string[]; limitPerSymbol?: number; forceTrades?: boolean } = {}): Promise<SyncReport> {
    const account = await this.ensureRealAccount();
    const report: SyncReport = {
      ok: false, accountId: account.id, balancesUpserted: 0, futuresPositions: 0,
      tradesSynced: 0, tradesSkipped: 0, equityAppended: false, at: Date.now(),
    };
    const limit = opts.limitPerSymbol ?? 200;
    // 清除过成交数据后暂停自动同步成交，防止脏数据回灌（手动同步 forceTrades 可强制）
    const skipTrades = !opts.forceTrades && (account.meta?.syncTrades === false);
    const equityParts: { usdt: number; note: string }[] = [];
    try {
      // ---------- 1) 现货 ----------
      const spot = await this.rest.spotAccount();
      for (const b of spot.balances) {
        if (b.free > 0 || b.locked > 0) {
          await this.storage.setBalance(account.id, b.asset, b.free, b.locked, 'SPOT');
          report.balancesUpserted++;
        }
      }
      await this.syncSymbolTrades(account.id, this.symbolsForSync(spot.balances.map((b) => b.asset), [], opts.symbols ?? []), limit, 'SPOT', report, skipTrades);

      // ---------- 2) 全仓杠杆 ----------
      try {
        const margin = await this.rest.marginAccount();
        for (const a of margin.assets) {
          if (a.netAsset > 0 || a.free > 0) {
            await this.storage.setBalance(account.id, a.asset, a.free, a.locked, 'MARGIN');
            report.balancesUpserted++;
          }
        }
        equityParts.push({ usdt: margin.totalNetAssetOfQuoteAsset, note: '全仓杠杆' });
        await this.syncSymbolTrades(account.id, this.symbolsForSync(margin.assets.map((a) => a.asset), [], opts.symbols ?? []), limit, 'MARGIN', report, skipTrades);
      } catch (e) {
        console.warn('[sync] margin account failed:', e instanceof Error ? e.message : String(e));
      }

      // ---------- 3) 逐仓杠杆（按交易对） ----------
      try {
        const isolated = await this.rest.marginIsolatedAccount();
        for (const p of isolated) {
          const base = p.baseAsset;
          if (base.netAsset > 0 || base.free > 0) {
            await this.storage.upsertPosition({
              accountId: account.id, symbol: p.symbol, market: 'MARGIN_ISOLATED', side: 'LONG',
              quantity: base.free + base.locked, avgEntryPrice: 0,
              unrealizedPnl: 0, realizedPnl: 0, updatedAt: Date.now(),
            });
            report.futuresPositions++;
          }
        }
        await this.syncSymbolTrades(account.id, isolated.map((p) => p.symbol), limit, 'MARGIN_ISOLATED', report, skipTrades);
      } catch (e) {
        console.warn('[sync] isolated margin failed:', e instanceof Error ? e.message : String(e));
      }

      // ---------- 4) U本位合约 ----------
      let futures: FuturesAccountInfo | null = null;
      try {
        futures = await this.rest.futuresAccount();
        for (const b of futures.balances) {
          if (b.walletBalance > 0) {
            await this.storage.setBalance(account.id, b.asset, b.walletBalance, 0, 'USDT_M');
            report.balancesUpserted++;
          }
        }
        for (const p of futures.positions) {
          await this.upsertFuturesPosition(account.id, p, 'USDT_M');
          report.futuresPositions++;
        }
        equityParts.push({ usdt: futures.totalWalletBalance + futures.totalUnrealizedProfit, note: 'U本位合约' });
        // U本位合约：默认品种 + 当前持仓 + 通过资金流水枚举的已交易品种（覆盖未持仓的历史品种）
        const usdtmSymbols = new Set<string>(this.symbolsForSync([], futures.positions.map((p) => p.symbol), opts.symbols ?? []));
        for (const s of await this.futuresSymbolsFromIncome('USDT_M')) usdtmSymbols.add(s);
        await this.syncSymbolTrades(account.id, [...usdtmSymbols], limit, 'USDT_M', report, skipTrades);
      } catch (e) {
        console.warn('[sync] usdt-m futures failed:', e instanceof Error ? e.message : String(e));
      }

      // ---------- 5) 币本位合约 ----------
      try {
        const coinm = await this.rest.coinmAccount();
        for (const b of coinm.assets) {
          if (b.walletBalance > 0) {
            await this.storage.setBalance(account.id, b.asset, b.walletBalance, 0, 'COIN_M');
            report.balancesUpserted++;
          }
        }
        for (const p of coinm.positions) {
          await this.upsertFuturesPosition(account.id, p, 'COIN_M');
          report.futuresPositions++;
        }
        equityParts.push({ usdt: coinm.totalWalletBalance + coinm.totalUnrealizedProfit, note: '币本位合约(按计价币计)' });
        // 币本位（COIN_M）只同步真实币本位 symbol（持仓 + income 枚举的币本位品种）。
        // 注意：不能复用 symbolsForSync（会带入 USDT 本位品种如 SOLUSDT）——
        // dapi 对被污染/不可达的 symbol 可能返回异常数据，造成假成交。
        const coinmSymbols = new Set<string>(coinm.positions.map((p) => p.symbol));
        for (const s of await this.futuresSymbolsFromIncome('COIN_M')) coinmSymbols.add(s);
        if (Array.isArray(opts.symbols) && opts.symbols.length) for (const s of opts.symbols) coinmSymbols.add(s);
        await this.syncSymbolTrades(account.id, [...coinmSymbols], limit, 'COIN_M', report, skipTrades);
      } catch (e) {
        console.warn('[sync] coin-m futures failed:', e instanceof Error ? e.message : String(e));
      }

      await this.appendEquity(account.id, spot.balances, futures, equityParts);
      report.equityAppended = true;
      report.ok = true;
    } catch (e) {
      report.message = e instanceof Error ? e.message : String(e);
    }
    this.lastReport = report;
    return report;
  }

  private async upsertFuturesPosition(accountId: string, p: { symbol: string; positionAmt: number; entryPrice: number; markPrice: number; unrealizedProfit: number; realizedProfit: number }, market: 'USDT_M' | 'COIN_M'): Promise<void> {
    const side = p.positionAmt >= 0 ? 'LONG' : 'SHORT';
    await this.storage.upsertPosition({
      accountId, symbol: p.symbol, market, side,
      quantity: Math.abs(p.positionAmt), avgEntryPrice: p.entryPrice,
      unrealizedPnl: p.unrealizedProfit, realizedPnl: p.realizedProfit, updatedAt: Date.now(),
    });
  }

  /** 同步用币种列表：默认 + 余额币种 + 合约持仓币种 + 显式指定（最多 30 个，避免请求过多） */
  private symbolsForSync(baseAssets: string[], futuresSymbols: string[], extra: string[]): string[] {
    const set = new Set<string>(DEFAULT_SYNC_SYMBOLS);
    for (const base of baseAssets) if (base !== 'USDT') set.add(base + 'USDT');
    for (const s of futuresSymbols) set.add(s);
    for (const s of extra) set.add(s.toUpperCase());
    return [...set].slice(0, 30);
  }

  /** 单个币种在指定市场的成交落库（幂等：id 冲突视为已同步） */
  /** 通过合约资金流水（income）枚举账户交易过的合约品种（覆盖已平仓、未持仓的历史品种） */
  private async futuresSymbolsFromIncome(market: 'USDT_M' | 'COIN_M'): Promise<string[]> {
    const symbols = new Set<string>();
    let from = 0;
    try {
      for (;;) {
        const rows = await this.rest.income(market, { startTime: from, limit: 1000 });
        if (!rows.length) break;
        for (const r of rows) if (r.symbol) symbols.add(r.symbol);
        if (rows.length < 1000) break;
        from = Number(rows[rows.length - 1]!.time) + 1;
      }
    } catch (e) {
      console.warn('[sync] income discovery failed (' + market + '):', e instanceof Error ? e.message : String(e));
    }
    return [...symbols];
  }

  /** 同步一组品种的成交；skip=true 时跳过（清除过成交数据后暂停自动回灌） */
  private async syncSymbolTrades(accountId: string, symbols: string[], limit: number, market: Market, report: SyncReport, skip: boolean): Promise<void> {
    if (skip) return;
    for (const symbol of symbols) {
      const { synced, skipped } = await this.syncTradesForSymbol(accountId, symbol, limit, market);
      report.tradesSynced += synced;
      report.tradesSkipped += skipped;
    }
  }

  /**
   * 增量同步单个品种成交：从本地该品种最新成交时间的下一条开始拉取。
   * - 本地无记录 → 全量拉取（startTime 缺省）；
   * - 超过单次 limit → 用 fromId 翻页继续，直到取完。
   */
  private async syncTradesForSymbol(accountId: string, symbol: string, limit: number, market: Market): Promise<{ synced: number; skipped: number }> {
    let synced = 0, skipped = 0;
    const latest = await this.storage.latestTradeTime(accountId, symbol, market);
    let fromId: number | undefined;
    let startTime: number | undefined = latest != null ? latest + 1 : undefined;
    for (;;) {
      let rows: MyTradeRow[] = [];
      try {
        rows = await this.rest.myTrades(market, symbol, { limit, fromId, startTime });
      } catch {
        return { synced, skipped }; // 该市场无此币种或无权限
      }
      if (!rows.length) break;
      for (const t of rows) {
        const trade: Trade = {
          id: 'real-' + symbol + '-' + market + '-' + t.id,
          orderId: String(t.orderId), accountId,
          symbol, market, side: t.side, qty: t.qty, price: t.price,
          fee: t.commission, feeAsset: t.commissionAsset, tradedAt: t.time,
          pnl: t.realizedPnl, realizedPnl: t.realizedPnl,
          meta: t.positionSide ? { positionSide: t.positionSide } : undefined,
        };
        try {
          await this.storage.createTrade(trade);
          synced++;
        } catch {
          skipped++; // 主键冲突 = 已同步过
        }
      }
      if (rows.length < limit) break; // 已取完
      const lastId = Number(rows[rows.length - 1]!.id);
      fromId = lastId + 1; // fromId 优先于 startTime（翻页）
      startTime = undefined;
    }
    return { synced, skipped };
  }

  /** 权益快照：现货 = Σ余额×最新价；杠杆/合约取账户字段；币本位按计价币估算 */
  private async appendEquity(
    accountId: string,
    spotBalances: SpotAccountInfo['balances'],
    futures: FuturesAccountInfo | null,
    equityParts: { usdt: number; note: string }[] = [],
  ): Promise<void> {
    let spotEquity = 0;
    const usdt = spotBalances.find((b) => b.asset === 'USDT');
    if (usdt) spotEquity += usdt.free;
    const priced = spotBalances.filter((b) => b.free > 0 && b.asset !== 'USDT');
    const tickers = priced.length > 0 ? await this.marketData.getTickers('SPOT').catch(() => []) : [];
    const priceMap = new Map(tickers.map((t) => [t.symbol, t.lastPrice]));
    for (const b of priced) {
      const px = priceMap.get(b.asset + 'USDT');
      if (px) spotEquity += b.free * px;
    }
    const futuresEquity = futures ? futures.totalWalletBalance + futures.totalUnrealizedProfit : 0;
    const unrealized = (futures?.totalUnrealizedProfit ?? 0) + equityParts.reduce((a, p) => a + (p.usdt > 0 ? 0 : 0), 0);
    let total = spotEquity + futuresEquity;
    for (const p of equityParts) total += p.usdt;
    await this.storage.appendEquity({
      accountId, timestamp: Date.now(),
      equity: total,
      cash: spotEquity + (futures?.totalWalletBalance ?? 0),
      unrealizedPnl: futures?.totalUnrealizedProfit ?? 0,
    });
  }
}
