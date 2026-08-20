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
  reachable: boolean;
  message?: string;
  spotHost: string;
  futuresHost: string;
  /** 当前代理配置（BINANCE_PROXY / BINANCE_PROXY_URL / HTTPS_PROXY） */
  proxy: ProxyConfig;
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

  constructor(storage: StorageAdapter, rest: BinanceRest, marketData: MarketDataProvider) {
    this.storage = storage;
    this.rest = rest;
    this.marketData = marketData;
  }

  async ensureRealAccount(): Promise<Account> {
    const existing = (await this.storage.listAccounts()).find((a) => a.type === 'real');
    if (existing) return existing;
    return this.storage.createAccount({ name: 'binance-real', type: 'real', meta: { source: 'binance' } });
  }

  /** 私有接口连通性（key 只对 api.binance.com / fapi.binance.com 有效） */
  async status(): Promise<BinanceStatus> {
    const configured = Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET);
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
    return { configured, reachable, message, spotHost: 'api.binance.com', futuresHost: 'fapi.binance.com', proxy: this.rest.proxy };
  }

  /** 全量同步：余额 → 合约持仓 → 成交 → 权益快照 */
  async syncAll(opts: { symbols?: string[]; limitPerSymbol?: number } = {}): Promise<SyncReport> {
    const account = await this.ensureRealAccount();
    const report: SyncReport = {
      ok: false, accountId: account.id, balancesUpserted: 0, futuresPositions: 0,
      tradesSynced: 0, tradesSkipped: 0, equityAppended: false, at: Date.now(),
    };
    try {
      const spot = await this.rest.spotAccount();
      // 合并现货 + 合约钱包余额（同一资产两市场合并展示，如 USDT）
      const merged = new Map<string, { free: number; locked: number }>();
      for (const b of spot.balances) {
        if (b.free > 0 || b.locked > 0) merged.set(b.asset, { free: b.free, locked: b.locked });
      }

      let futures: FuturesAccountInfo | null = null;
      try {
        futures = await this.rest.futuresAccount();
        for (const b of futures.balances) {
          if (b.walletBalance > 0) {
            const cur = merged.get(b.asset) ?? { free: 0, locked: 0 };
            merged.set(b.asset, { free: cur.free + b.walletBalance, locked: cur.locked });
          }
        }
        for (const p of futures.positions) {
          const side = p.positionAmt >= 0 ? 'LONG' : 'SHORT';
          await this.storage.upsertPosition({
            accountId: account.id, symbol: p.symbol, market: 'USDT_M', side,
            quantity: Math.abs(p.positionAmt), avgEntryPrice: p.entryPrice,
            unrealizedPnl: p.unrealizedProfit, realizedPnl: p.realizedProfit, updatedAt: Date.now(),
          });
          report.futuresPositions++;
        }
      } catch (e) {
        // 合约接口不可达不影响现货同步
        console.warn('[sync] futures account failed:', e instanceof Error ? e.message : String(e));
      }

      for (const [asset, b] of merged) {
        await this.storage.setBalance(account.id, asset, b.free, b.locked);
        report.balancesUpserted++;
      }

      const symbols = this.symbolsForSync(spot.balances.map((b) => b.asset), futures?.positions.map((p) => p.symbol) ?? [], opts.symbols ?? []);
      for (const symbol of symbols) {
        const { synced, skipped } = await this.syncTradesForSymbol(account.id, symbol, opts.limitPerSymbol ?? 100);
        report.tradesSynced += synced;
        report.tradesSkipped += skipped;
      }

      await this.appendEquity(account.id, spot.balances, futures);
      report.equityAppended = true;
      report.ok = true;
    } catch (e) {
      report.message = e instanceof Error ? e.message : String(e);
    }
    return report;
  }

  /** 同步用币种列表：默认 + 余额币种 + 合约持仓币种 + 显式指定（最多 30 个，避免请求过多） */
  private symbolsForSync(baseAssets: string[], futuresSymbols: string[], extra: string[]): string[] {
    const set = new Set<string>(DEFAULT_SYNC_SYMBOLS);
    for (const base of baseAssets) if (base !== 'USDT') set.add(base + 'USDT');
    for (const s of futuresSymbols) set.add(s);
    for (const s of extra) set.add(s.toUpperCase());
    return [...set].slice(0, 30);
  }

  /** 单个币种：现货 + 合约两市场的成交都拉取，落库（幂等：id 冲突视为已同步） */
  private async syncTradesForSymbol(accountId: string, symbol: string, limit: number): Promise<{ synced: number; skipped: number }> {
    let synced = 0, skipped = 0;
    for (const market of ['SPOT', 'USDT_M'] as Market[]) {
      let rows: MyTradeRow[] = [];
      try {
        rows = await this.rest.myTrades(market, symbol, { limit });
      } catch {
        continue; // 该市场无此币种或无权限
      }
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
    }
    return { synced, skipped };
  }

  /** 权益快照：现货 = Σ余额×最新价；合约 = 账户字段（totalWalletBalance + 未实现盈亏） */
  private async appendEquity(accountId: string, spotBalances: SpotAccountInfo['balances'], futures: FuturesAccountInfo | null): Promise<void> {
    let spotEquity = 0;
    const usdt = spotBalances.find((b) => b.asset === 'USDT');
    if (usdt) spotEquity += usdt.free;
    const priced = spotBalances.filter((b) => b.free > 0 && b.asset !== 'USDT');
    if (priced.length > 0) {
      try {
        const tickers = await this.marketData.getTickers('SPOT');
        const priceMap = new Map(tickers.map((t) => [t.symbol, t.lastPrice]));
        for (const b of priced) {
          const px = priceMap.get(b.asset + 'USDT');
          if (px) spotEquity += b.free * px;
        }
      } catch {
        // 取不到价格时只按 USDT 计
      }
    }
    const futuresWallet = futures?.totalWalletBalance ?? 0;
    const futuresUnrealized = futures?.totalUnrealizedProfit ?? 0;
    await this.storage.appendEquity({
      accountId, timestamp: Date.now(),
      equity: spotEquity + futuresWallet + futuresUnrealized,
      cash: spotEquity + futuresWallet,
      unrealizedPnl: futuresUnrealized,
    });
  }
}
