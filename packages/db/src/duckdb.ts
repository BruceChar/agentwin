import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import duckdb from 'duckdb';
import type {
  Account, Balance, Candle, CandleKey, EquityPoint, Interval, JournalEntry, JournalKind,
  LLMMessage, LLMSession, LLMSessionKind, Market, NewAccount, NewOrder, Order, OrderStatus,
  Position, SentimentRecord, StrategyConfig, Trade, TradeAggregates, TradeJournal,
} from '@agentwin/shared';
import { MIGRATIONS } from './migrations.ts';
import type { BacktestRunRecord, KlineFilter, OrderFilter, StorageAdapter, TradeFilter } from './storage.ts';

type Row = Record<string, unknown>;

function parseJson<T>(s: unknown): T | undefined {
  if (s === null || s === undefined || s === '') return undefined;
  try { return JSON.parse(String(s)) as T; } catch { return undefined; }
}

function mapOrder(r: Row): Order {
  return {
    id: String(r.id), accountId: String(r.account_id), strategyId: r.strategy_id != null ? String(r.strategy_id) : undefined,
    symbol: String(r.symbol), market: String(r.market) as Market, side: String(r.side) as Order['side'],
    type: String(r.type) as Order['type'], price: r.price != null ? Number(r.price) : undefined,
    quantity: Number(r.quantity), filledQty: Number(r.filled_qty),
    avgFillPrice: r.avg_fill_price != null ? Number(r.avg_fill_price) : undefined,
    status: String(r.status) as OrderStatus, fee: r.fee != null ? Number(r.fee) : undefined,
    feeAsset: r.fee_asset != null ? String(r.fee_asset) : undefined,
    meta: parseJson<Record<string, unknown>>(r.meta),
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}

/**
 * DuckDB 存储实现：分析型本地数据库（列存、向量化），适合大量 K 线/回测数据。
 * 与 SQLite 实现共享 StorageAdapter 接口，通过 createStorage({ engine: 'duckdb' }) 切换。
 */
export class DuckdbStorage implements StorageAdapter {
  readonly engine = 'duckdb';
  private db: duckdb.Database;
  private readonly path: string;

  constructor(path = ':memory:') {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new duckdb.Database(path);
  }

  // ---------- 底层封装 ----------
  private exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (e) => (e ? reject(new Error(e.message)) : resolve()));
    });
  }

  private run(sql: string, ...params: unknown[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const cb = (e: Error | null) => (e ? reject(new Error(e.message)) : resolve());
      // duckdb 需要可变参数；无参数时直接回调
      if (params.length === 0) this.db.run(sql, cb);
      else this.db.run(sql, ...params, cb);
    });
  }

  private all(sql: string, ...params: unknown[]): Promise<Row[]> {
    return new Promise((resolve, reject) => {
      const cb = (e: Error | null, rows: Row[]) => (e ? reject(new Error(e.message)) : resolve(rows ?? []));
      if (params.length === 0) this.db.all(sql, cb);
      else this.db.all(sql, ...params, cb);
    });
  }

  private get(sql: string, ...params: unknown[]): Promise<Row | undefined> {
    return this.all(sql, ...params).then((rows) => rows[0]);
  }

  async init(): Promise<void> {
    await this.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)');
    const applied = new Set((await this.all('SELECT version FROM _migrations')).map((r) => Number(r.version)));
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      await this.exec('BEGIN');
      try {
        await this.exec(m.sql);
        await this.run('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)', m.version, Date.now());
        await this.exec('COMMIT');
      } catch (e) {
        await this.exec('ROLLBACK');
        throw e;
      }
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close(() => resolve());
    });
  }

  // ---------- 账户 ----------
  async createAccount(a: NewAccount): Promise<Account> {
    const now = Date.now();
    const id = a.id ?? randomUUID();
    await this.run(
      'INSERT INTO accounts (id, name, type, currency, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      id, a.name, a.type, a.currency ?? 'USDT', a.meta ? JSON.stringify(a.meta) : null, now, now,
    );
    return { id, name: a.name, type: a.type, currency: a.currency ?? 'USDT', createdAt: now, updatedAt: now, meta: a.meta };
  }

  async getAccount(id: string): Promise<Account | null> {
    const r = await this.get('SELECT * FROM accounts WHERE id = ?', id);
    if (!r) return null;
    return {
      id: String(r.id), name: String(r.name), type: String(r.type) as Account['type'],
      currency: String(r.currency), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
      meta: parseJson<Record<string, unknown>>(r.meta),
    };
  }

  async updateAccount(id: string, patch: Partial<Pick<Account, 'name' | 'meta'>>): Promise<Account | null> {
    const cur = await this.getAccount(id);
    if (!cur) return null;
    const name = patch.name ?? cur.name;
    const meta = patch.meta !== undefined ? patch.meta : cur.meta;
    await this.run('UPDATE accounts SET name = ?, meta = ?, updated_at = ? WHERE id = ?', name, meta ? JSON.stringify(meta) : null, Date.now(), id);
    return { ...cur, name, meta, updatedAt: Date.now() };
  }

  async listAccounts(): Promise<Account[]> {
    const rows = await this.all('SELECT * FROM accounts ORDER BY created_at ASC');
    return rows.map((r) => ({
      id: String(r.id), name: String(r.name), type: String(r.type) as Account['type'],
      currency: String(r.currency), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
      meta: parseJson<Record<string, unknown>>(r.meta),
    }));
  }

  async setBalance(accountId: string, asset: string, free: number, locked = 0, market: Market = 'SPOT'): Promise<void> {
    await this.run(
      `INSERT INTO balances (account_id, market, asset, free, locked, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(account_id, market, asset) DO UPDATE SET free=excluded.free, locked=excluded.locked, updated_at=excluded.updated_at`,
      accountId, market, asset, free, locked, Date.now(),
    );
  }

  async getBalances(accountId: string, market?: Market): Promise<Balance[]> {
    const rows = market
      ? await this.all('SELECT * FROM balances WHERE account_id = ? AND market = ? ORDER BY asset', accountId, market)
      : await this.all('SELECT * FROM balances WHERE account_id = ? ORDER BY market, asset', accountId);
    return rows.map((r) => ({
      accountId, market: String(r.market) as Market, asset: String(r.asset), free: Number(r.free), locked: Number(r.locked),
      total: Number(r.free) + Number(r.locked),
    }));
  }

  // ---------- K 线 ----------
  async upsertKlines(rows: (Candle & CandleKey)[]): Promise<number> {
    if (rows.length === 0) return 0;
    await this.exec('BEGIN');
    try {
      for (const k of rows) {
        await this.run(
          `INSERT INTO klines (symbol,market,interval,open_time,open,high,low,close,volume,close_time,quote_volume,trades,taker_buy_base,taker_buy_quote)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(symbol,market,interval,open_time) DO UPDATE SET
             open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
             volume=excluded.volume, close_time=excluded.close_time, quote_volume=excluded.quote_volume,
             trades=excluded.trades, taker_buy_base=excluded.taker_buy_base, taker_buy_quote=excluded.taker_buy_quote`,
          k.symbol, k.market, k.interval, k.openTime, k.open, k.high, k.low, k.close, k.volume, k.closeTime, k.quoteVolume, k.trades, k.takerBuyBase, k.takerBuyQuote,
        );
      }
      await this.exec('COMMIT');
    } catch (e) {
      await this.exec('ROLLBACK');
      throw e;
    }
    return rows.length;
  }

  async getKlines(f: KlineFilter): Promise<Candle[]> {
    const conds = ['symbol = ?', 'market = ?', 'interval = ?'];
    const params: (string | number)[] = [f.symbol, f.market, f.interval];
    if (f.from !== undefined) { conds.push('open_time >= ?'); params.push(f.from); }
    if (f.to !== undefined) { conds.push('open_time <= ?'); params.push(f.to); }
    const where = conds.join(' AND ');
    const rows = f.limit !== undefined
      ? await this.all(`SELECT * FROM (SELECT * FROM klines WHERE ${where} ORDER BY open_time DESC LIMIT ?) ORDER BY open_time ASC`, ...params, f.limit)
      : await this.all(`SELECT * FROM klines WHERE ${where} ORDER BY open_time ASC`, ...params);
    return rows.map((r) => ({
      openTime: Number(r.open_time), open: Number(r.open), high: Number(r.high), low: Number(r.low),
      close: Number(r.close), volume: Number(r.volume), closeTime: Number(r.close_time),
      quoteVolume: Number(r.quote_volume), trades: Number(r.trades),
      takerBuyBase: Number(r.taker_buy_base), takerBuyQuote: Number(r.taker_buy_quote),
    }));
  }

  async countKlines(symbol: string, market: Market, interval: Interval): Promise<number> {
    const r = await this.get('SELECT COUNT(*) AS c FROM klines WHERE symbol=? AND market=? AND interval=?', symbol, market, interval);
    return Number(r?.c ?? 0);
  }

  // ---------- 订单 ----------
  async createOrder(o: NewOrder): Promise<Order> {
    const now = o.createdAt ?? Date.now();
    const id = o.id ?? randomUUID();
    await this.run(
      'INSERT INTO orders (id, account_id, strategy_id, symbol, market, side, type, price, quantity, filled_qty, avg_fill_price, status, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,NULL,?,?,?,?)',
      id, o.accountId, o.strategyId ?? null, o.symbol, o.market, o.side, o.type, o.price ?? null, o.quantity, 'NEW', o.meta ? JSON.stringify(o.meta) : null, now, now,
    );
    return { id, accountId: o.accountId, strategyId: o.strategyId, symbol: o.symbol, market: o.market, side: o.side, type: o.type, price: o.price, quantity: o.quantity, filledQty: 0, status: 'NEW', createdAt: now, updatedAt: now, meta: o.meta };
  }

  async patchOrder(id: string, patch: Partial<Order>): Promise<Order | null> {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const map: Record<string, string> = {
      price: 'price', quantity: 'quantity', filledQty: 'filled_qty', avgFillPrice: 'avg_fill_price',
      status: 'status', fee: 'fee', feeAsset: 'fee_asset', meta: 'meta',
    };
    for (const [k, v] of Object.entries(patch)) {
      const col = map[k];
      if (!col) continue;
      sets.push(col + ' = ?');
      if (v === undefined) params.push(null);
      else if (k === 'meta') params.push(JSON.stringify(v));
      else params.push(v as number);
    }
    if (sets.length === 0) return this.getOrder(id);
    sets.push('updated_at = ?');
    params.push(Date.now(), id);
    await this.run(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, ...params);
    return this.getOrder(id);
  }

  async getOrder(id: string): Promise<Order | null> {
    const r = await this.get('SELECT * FROM orders WHERE id = ?', id);
    return r ? mapOrder(r) : null;
  }

  async listOrders(f: OrderFilter = {}): Promise<Order[]> {
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (f.accountId) { conds.push('account_id = ?'); params.push(f.accountId); }
    if (f.strategyId) { conds.push('strategy_id = ?'); params.push(f.strategyId); }
    if (f.symbol) { conds.push('symbol = ?'); params.push(f.symbol); }
    if (f.market) { conds.push('market = ?'); params.push(f.market); }
    if (f.status) { conds.push('status = ?'); params.push(f.status); }
    if (f.from !== undefined) { conds.push('created_at >= ?'); params.push(f.from); }
    if (f.to !== undefined) { conds.push('created_at <= ?'); params.push(f.to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    let sql = `SELECT * FROM orders ${where} ORDER BY created_at DESC`;
    if (f.limit !== undefined) { sql += ' LIMIT ?'; params.push(f.limit); }
    const rows = await this.all(sql, ...params);
    return rows.map(mapOrder);
  }

  // ---------- 成交 ----------
  async createTrade(t: Trade): Promise<Trade> {
    await this.run(
      'INSERT INTO trades (id, order_id, account_id, strategy_id, symbol, market, side, qty, price, fee, fee_asset, pnl, realized_pnl, meta, traded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      t.id, t.orderId, t.accountId, t.strategyId ?? null, t.symbol, t.market, t.side, t.qty, t.price, t.fee, t.feeAsset ?? null, t.pnl ?? null, t.realizedPnl ?? null, t.meta ? JSON.stringify(t.meta) : null, t.tradedAt,
    );
    return t;
  }

  async deleteTradesByAccount(accountId: string): Promise<number> {
    const rows = await this.all('SELECT COUNT(*) AS c FROM trades WHERE account_id = ?', accountId);
    await this.run('DELETE FROM trades WHERE account_id = ?', accountId);
    return Number(rows[0]?.c ?? 0);
  }

  async latestTradeTime(accountId: string, symbol: string, market: Market): Promise<number | null> {
    const rows = await this.all('SELECT MAX(traded_at) AS t FROM trades WHERE account_id = ? AND symbol = ? AND market = ?', accountId, symbol, market);
    const t = rows[0]?.t;
    return t != null ? Number(t) : null;
  }

  async wipeAll(): Promise<void> {
    const tables = ['trades', 'orders', 'balances', 'positions', 'equity_snapshots', 'accounts', 'strategies', 'journal', 'trade_journal', 'llm_messages', 'llm_sessions', 'sentiment', 'backtests', 'klines'];
    for (const t of tables) {
      await this.run('DELETE FROM ' + t);
    }
  }

  async listTrades(f: TradeFilter = {}): Promise<Trade[]> {
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (f.accountId) { conds.push('account_id = ?'); params.push(f.accountId); }
    if (f.strategyId) { conds.push('strategy_id = ?'); params.push(f.strategyId); }
    if (f.symbol) { conds.push('symbol = ?'); params.push(f.symbol); }
    if (f.market) { conds.push('market = ?'); params.push(f.market); }
    if (f.from !== undefined) { conds.push('traded_at >= ?'); params.push(f.from); }
    if (f.to !== undefined) { conds.push('traded_at <= ?'); params.push(f.to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    let sql = `SELECT * FROM trades ${where} ORDER BY traded_at DESC`;
    if (f.limit !== undefined) { sql += ' LIMIT ?'; params.push(f.limit); }
    const rows = await this.all(sql, ...params);
    return rows.map((r) => ({
      id: String(r.id), orderId: String(r.order_id), accountId: String(r.account_id),
      strategyId: r.strategy_id != null ? String(r.strategy_id) : undefined,
      symbol: String(r.symbol), market: String(r.market) as Market, side: String(r.side) as Trade['side'],
      qty: Number(r.qty), price: Number(r.price), fee: Number(r.fee),
      feeAsset: r.fee_asset != null ? String(r.fee_asset) : undefined,
      pnl: r.pnl != null ? Number(r.pnl) : undefined,
      realizedPnl: r.realized_pnl != null ? Number(r.realized_pnl) : undefined,
      meta: parseJson<Record<string, unknown>>(r.meta), tradedAt: Number(r.traded_at),
    }));
  }

  async tradeAggregates(f: TradeFilter = {}): Promise<TradeAggregates> {
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (f.accountId) { conds.push('account_id = ?'); params.push(f.accountId); }
    if (f.strategyId) { conds.push('strategy_id = ?'); params.push(f.strategyId); }
    if (f.symbol) { conds.push('symbol = ?'); params.push(f.symbol); }
    if (f.market) { conds.push('market = ?'); params.push(f.market); }
    if (f.from !== undefined) { conds.push('traded_at >= ?'); params.push(f.from); }
    if (f.to !== undefined) { conds.push('traded_at <= ?'); params.push(f.to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const row = await this.get(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END),0) AS wins,
        COALESCE(SUM(CASE WHEN realized_pnl < 0 THEN 1 ELSE 0 END),0) AS losses,
        COALESCE(SUM(CASE WHEN realized_pnl > 0 THEN realized_pnl ELSE 0 END),0) AS gross_profit,
        COALESCE(SUM(CASE WHEN realized_pnl < 0 THEN realized_pnl ELSE 0 END),0) AS gross_loss,
        COALESCE(SUM(realized_pnl),0) AS net_pnl,
        COALESCE(SUM(fee),0) AS fees,
        COALESCE(AVG(CASE WHEN realized_pnl > 0 THEN realized_pnl END),0) AS avg_win,
        COALESCE(AVG(CASE WHEN realized_pnl < 0 THEN realized_pnl END),0) AS avg_loss
      FROM trades ${where}`, ...params);
    const wins = Number(row?.wins ?? 0), losses = Number(row?.losses ?? 0), grossLoss = Number(row?.gross_loss ?? 0);
    const byRows = await this.all(`
      SELECT symbol, COUNT(*) AS n, COALESCE(SUM(realized_pnl),0) AS net,
             SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) AS w,
             SUM(CASE WHEN realized_pnl < 0 THEN 1 ELSE 0 END) AS l
      FROM trades ${where} GROUP BY symbol`, ...params);
    const bySymbol: TradeAggregates['bySymbol'] = {};
    for (const b of byRows) {
      const w = Number(b.w), l = Number(b.l);
      bySymbol[String(b.symbol)] = { trades: Number(b.n), netPnl: Number(b.net), winRate: w + l > 0 ? w / (w + l) : 0 };
    }
    const decided = wins + losses;
    return {
      totalTrades: Number(row?.total ?? 0), wins, losses,
      winRate: decided > 0 ? wins / decided : 0,
      grossProfit: Number(row?.gross_profit ?? 0), grossLoss,
      netPnl: Number(row?.net_pnl ?? 0), feesPaid: Number(row?.fees ?? 0),
      avgWin: Number(row?.avg_win ?? 0), avgLoss: Number(row?.avg_loss ?? 0),
      profitFactor: grossLoss !== 0 ? Number(row?.gross_profit ?? 0) / Math.abs(grossLoss) : (Number(row?.gross_profit ?? 0) > 0 ? Infinity : 0),
      bySymbol,
    };
  }

  // ---------- 持仓 ----------
  async upsertPosition(p: Position): Promise<void> {
    await this.run(
      `INSERT INTO positions (account_id, symbol, market, side, quantity, avg_entry_price, unrealized_pnl, realized_pnl, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(account_id, symbol, market) DO UPDATE SET
         side=excluded.side, quantity=excluded.quantity, avg_entry_price=excluded.avg_entry_price,
         unrealized_pnl=excluded.unrealized_pnl, realized_pnl=excluded.realized_pnl, updated_at=excluded.updated_at`,
      p.accountId, p.symbol, p.market, p.side, p.quantity, p.avgEntryPrice, p.unrealizedPnl, p.realizedPnl, p.updatedAt,
    );
  }

  async getPositions(accountId: string): Promise<Position[]> {
    const rows = await this.all('SELECT * FROM positions WHERE account_id = ?', accountId);
    return rows.map((r) => ({
      accountId, symbol: String(r.symbol), market: String(r.market) as Market,
      side: String(r.side) as Position['side'], quantity: Number(r.quantity),
      avgEntryPrice: Number(r.avg_entry_price), unrealizedPnl: Number(r.unrealized_pnl),
      realizedPnl: Number(r.realized_pnl), updatedAt: Number(r.updated_at),
    }));
  }

  async deletePosition(accountId: string, symbol: string, market: Market): Promise<void> {
    await this.run('DELETE FROM positions WHERE account_id = ? AND symbol = ? AND market = ?', accountId, symbol, market);
  }

  async clearPositions(accountId: string): Promise<void> {
    await this.run('DELETE FROM positions WHERE account_id = ?', accountId);
  }

  // ---------- 策略 ----------
  async createStrategy(s: StrategyConfig): Promise<StrategyConfig> {
    await this.run(
      'INSERT INTO strategies (id, name, description, market, symbol, interval, parameters, source, enabled, parent_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      s.id, s.name, s.description ?? null, s.market, s.symbol, s.interval, JSON.stringify(s.parameters), s.source, s.enabled ? 1 : 0, s.parentId ?? null, s.createdAt, s.updatedAt,
    );
    return s;
  }

  async updateStrategy(id: string, patch: Partial<StrategyConfig>): Promise<StrategyConfig | null> {
    const cur = await this.getStrategy(id);
    if (!cur) return null;
    const next: StrategyConfig = { ...cur, ...patch, updatedAt: Date.now() };
    await this.run(
      'UPDATE strategies SET name=?, description=?, market=?, symbol=?, interval=?, parameters=?, source=?, enabled=?, parent_id=?, updated_at=? WHERE id=?',
      next.name, next.description ?? null, next.market, next.symbol, next.interval, JSON.stringify(next.parameters), next.source, next.enabled ? 1 : 0, next.parentId ?? null, next.updatedAt, id,
    );
    return next;
  }

  async getStrategy(id: string): Promise<StrategyConfig | null> {
    const r = await this.get('SELECT * FROM strategies WHERE id = ?', id);
    return r ? this.mapStrategy(r) : null;
  }

  async listStrategies(): Promise<StrategyConfig[]> {
    const rows = await this.all('SELECT * FROM strategies ORDER BY created_at ASC');
    return rows.map(this.mapStrategy);
  }

  private mapStrategy(r: Row): StrategyConfig {
    return {
      id: String(r.id), name: String(r.name), description: r.description != null ? String(r.description) : undefined,
      market: String(r.market) as Market, symbol: String(r.symbol), interval: String(r.interval) as Interval,
      parameters: parseJson<Record<string, number | string | boolean>>(r.parameters) ?? {},
      source: String(r.source) as StrategyConfig['source'], enabled: Number(r.enabled) === 1,
      parentId: r.parent_id != null ? String(r.parent_id) : undefined,
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
  }

  // ---------- 权益 ----------
  async appendEquity(p: EquityPoint): Promise<void> {
    await this.run(
      'INSERT INTO equity_snapshots (account_id, ts, equity, cash, unrealized_pnl) VALUES (?,?,?,?,?) ON CONFLICT(account_id, ts) DO NOTHING',
      p.accountId, p.timestamp, p.equity, p.cash, p.unrealizedPnl,
    );
  }

  async getEquityCurve(accountId: string, from?: number, to?: number): Promise<EquityPoint[]> {
    const conds = ['account_id = ?'];
    const params: (string | number)[] = [accountId];
    if (from !== undefined) { conds.push('ts >= ?'); params.push(from); }
    if (to !== undefined) { conds.push('ts <= ?'); params.push(to); }
    const rows = await this.all(`SELECT * FROM equity_snapshots WHERE ${conds.join(' AND ')} ORDER BY ts ASC`, ...params);
    return rows.map((r) => ({
      accountId, timestamp: Number(r.ts), equity: Number(r.equity), cash: Number(r.cash), unrealizedPnl: Number(r.unrealized_pnl),
    }));
  }

  async clearEquityCurve(accountId: string): Promise<number> {
    const rows = await this.all('SELECT COUNT(*) AS c FROM equity_snapshots WHERE account_id = ?', accountId);
    await this.run('DELETE FROM equity_snapshots WHERE account_id = ?', accountId);
    return Number(rows[0]?.c ?? 0);
  }

  // ---------- LLM ----------
  async createSession(s: { id?: string; kind: LLMSessionKind; title: string; meta?: Record<string, unknown> }): Promise<LLMSession> {
    const now = Date.now();
    const id = s.id ?? randomUUID();
    await this.run('INSERT INTO llm_sessions (id, kind, title, meta, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      id, s.kind, s.title, s.meta ? JSON.stringify(s.meta) : null, now, now);
    return { id, kind: s.kind, title: s.title, createdAt: now, updatedAt: now, meta: s.meta };
  }

  async appendMessage(m: { sessionId: string; role: LLMMessage['role']; content: string; toolCalls?: unknown[] }): Promise<LLMMessage> {
    const now = Date.now();
    const id = randomUUID();
    await this.run('INSERT INTO llm_messages (id, session_id, role, content, tool_calls, created_at) VALUES (?,?,?,?,?,?)',
      id, m.sessionId, m.role, m.content, m.toolCalls ? JSON.stringify(m.toolCalls) : null, now);
    await this.run('UPDATE llm_sessions SET updated_at = ? WHERE id = ?', now, m.sessionId);
    return { id, sessionId: m.sessionId, role: m.role, content: m.content, toolCalls: m.toolCalls, createdAt: now };
  }

  async getSession(id: string): Promise<LLMSession | null> {
    const r = await this.get('SELECT * FROM llm_sessions WHERE id = ?', id);
    if (!r) return null;
    return {
      id: String(r.id), kind: String(r.kind) as LLMSessionKind, title: String(r.title),
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), meta: parseJson<Record<string, unknown>>(r.meta),
    };
  }

  async listSessions(kind?: LLMSessionKind): Promise<LLMSession[]> {
    const rows = kind
      ? await this.all('SELECT * FROM llm_sessions WHERE kind = ? ORDER BY updated_at DESC', kind)
      : await this.all('SELECT * FROM llm_sessions ORDER BY updated_at DESC');
    return rows.map((r) => ({
      id: String(r.id), kind: String(r.kind) as LLMSessionKind, title: String(r.title),
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), meta: parseJson<Record<string, unknown>>(r.meta),
    }));
  }

  async listMessages(sessionId: string): Promise<LLMMessage[]> {
    const rows = await this.all('SELECT * FROM llm_messages WHERE session_id = ? ORDER BY created_at ASC', sessionId);
    return rows.map((r) => ({
      id: String(r.id), sessionId: String(r.session_id), role: String(r.role) as LLMMessage['role'],
      content: String(r.content), toolCalls: parseJson<unknown[]>(r.tool_calls), createdAt: Number(r.created_at),
    }));
  }

  // ---------- 舆情 ----------
  async upsertSentiment(r: SentimentRecord): Promise<void> {
    await this.run(
      `INSERT INTO sentiment (id, source, symbol, headline, body, url, published_at, score, label, keywords, model, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET score=excluded.score, label=excluded.label, keywords=excluded.keywords`,
      r.id, r.source, r.symbol, r.headline, r.body ?? null, r.url ?? null, r.publishedAt ?? null, r.score, r.label, JSON.stringify(r.keywords), r.model ?? null, r.createdAt,
    );
  }

  async listSentiment(f: { symbol?: string; from?: number; to?: number; limit?: number } = {}): Promise<SentimentRecord[]> {
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (f.symbol) { conds.push('symbol = ?'); params.push(f.symbol); }
    if (f.from !== undefined) { conds.push('created_at >= ?'); params.push(f.from); }
    if (f.to !== undefined) { conds.push('created_at <= ?'); params.push(f.to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    let sql = `SELECT * FROM sentiment ${where} ORDER BY created_at DESC`;
    if (f.limit !== undefined) { sql += ' LIMIT ?'; params.push(f.limit); }
    const rows = await this.all(sql, ...params);
    return rows.map((r) => ({
      id: String(r.id), source: String(r.source) as SentimentRecord['source'], symbol: String(r.symbol),
      headline: String(r.headline), body: r.body != null ? String(r.body) : undefined,
      url: r.url != null ? String(r.url) : undefined, publishedAt: r.published_at != null ? Number(r.published_at) : undefined,
      score: Number(r.score), label: String(r.label) as SentimentRecord['label'],
      keywords: parseJson<string[]>(r.keywords) ?? [], model: r.model != null ? String(r.model) : undefined,
      createdAt: Number(r.created_at),
    }));
  }

  // ---------- 回测 ----------
  async saveBacktest(b: Omit<BacktestRunRecord, 'id' | 'createdAt'> & { createdAt?: number }): Promise<BacktestRunRecord> {
    const id = randomUUID();
    const now = b.createdAt ?? Date.now();
    await this.run(
      'INSERT INTO backtests (id, strategy_id, symbol, market, interval, from_ts, to_ts, initial_capital, request_json, result_json, metrics_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, b.strategyId ?? null, b.symbol, b.market, b.interval, b.from, b.to, b.initialCapital, JSON.stringify(b.request), JSON.stringify(b.result), JSON.stringify(b.metrics), now,
    );
    return { ...b, id, createdAt: now };
  }

  async getBacktest(id: string): Promise<BacktestRunRecord | null> {
    const r = await this.get('SELECT * FROM backtests WHERE id = ?', id);
    if (!r) return null;
    return {
      id: String(r.id), strategyId: r.strategy_id != null ? String(r.strategy_id) : undefined,
      symbol: String(r.symbol), market: String(r.market) as Market, interval: String(r.interval) as Interval,
      from: Number(r.from_ts), to: Number(r.to_ts), initialCapital: Number(r.initial_capital),
      request: parseJson(r.request_json), result: parseJson(r.result_json), metrics: parseJson(r.metrics_json),
      createdAt: Number(r.created_at),
    };
  }

  async listBacktests(limit = 20): Promise<BacktestRunRecord[]> {
    const rows = await this.all('SELECT * FROM backtests ORDER BY created_at DESC LIMIT ?', limit);
    return rows.map((r) => ({
      id: String(r.id), strategyId: r.strategy_id != null ? String(r.strategy_id) : undefined,
      symbol: String(r.symbol), market: String(r.market) as Market, interval: String(r.interval) as Interval,
      from: Number(r.from_ts), to: Number(r.to_ts), initialCapital: Number(r.initial_capital),
      request: parseJson(r.request_json), result: parseJson(r.result_json), metrics: parseJson(r.metrics_json),
      createdAt: Number(r.created_at),
    }));
  }

  // ---------- 日志 ----------
  async createJournalEntry(e: { id?: string; accountId?: string; kind: JournalKind; title: string; body: string; tags?: string[]; createdAt?: number }): Promise<JournalEntry> {
    const id = e.id ?? randomUUID();
    const now = e.createdAt ?? Date.now();
    await this.run('INSERT INTO journal (id, account_id, kind, title, body, tags, created_at) VALUES (?,?,?,?,?,?,?)',
      id, e.accountId ?? null, e.kind, e.title, e.body, JSON.stringify(e.tags ?? []), now);
    return { id, accountId: e.accountId, kind: e.kind, title: e.title, body: e.body, tags: e.tags ?? [], createdAt: now };
  }

  async listJournalEntries(f: { accountId?: string; limit?: number } = {}): Promise<JournalEntry[]> {
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (f.accountId) { conds.push('account_id = ?'); params.push(f.accountId); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    let sql = `SELECT * FROM journal ${where} ORDER BY created_at DESC`;
    if (f.limit !== undefined) { sql += ' LIMIT ?'; params.push(f.limit); }
    const rows = await this.all(sql, ...params);
    return rows.map((r) => ({
      id: String(r.id), accountId: r.account_id != null ? String(r.account_id) : undefined,
      kind: String(r.kind) as JournalKind, title: String(r.title), body: String(r.body),
      tags: parseJson<string[]>(r.tags) ?? [], createdAt: Number(r.created_at),
    }));
  }

  // ---------- 结构化交易日志（SQLite 镜像） ----------
  async upsertTradeJournal(j: TradeJournal): Promise<void> {
    await this.run(
      `INSERT INTO trade_journal (id, trade_no, symbol, market, direction, open_time, close_time, pnl, net_pnl, r_multiple, discipline_score, tags, data, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         trade_no=excluded.trade_no, symbol=excluded.symbol, market=excluded.market, direction=excluded.direction,
         open_time=excluded.open_time, close_time=excluded.close_time, pnl=excluded.pnl, net_pnl=excluded.net_pnl,
         r_multiple=excluded.r_multiple, discipline_score=excluded.discipline_score, tags=excluded.tags,
         data=excluded.data, updated_at=excluded.updated_at`,
      j.id, j.tradeNo, j.symbol, j.market, j.direction,
      j.openTime ?? null, j.closeTime ?? null, j.pnl ?? null, j.netPnl ?? null, j.rMultiple ?? null,
      j.disciplineScore ?? null, JSON.stringify(j.tags), JSON.stringify(j), j.createdAt, j.updatedAt,
    );
  }

  async getTradeJournal(id: string): Promise<TradeJournal | null> {
    const r = await this.get('SELECT data FROM trade_journal WHERE id = ?', id);
    return r ? parseJson<TradeJournal>(r.data) ?? null : null;
  }

  async listTradeJournals(f: { symbol?: string; market?: string; from?: number; to?: number; limit?: number } = {}): Promise<TradeJournal[]> {
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (f.symbol) { conds.push('symbol = ?'); params.push(f.symbol); }
    if (f.market) { conds.push('market = ?'); params.push(f.market); }
    if (f.from !== undefined) { conds.push('close_time >= ?'); params.push(f.from); }
    if (f.to !== undefined) { conds.push('close_time <= ?'); params.push(f.to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    let sql = `SELECT data FROM trade_journal ${where} ORDER BY close_time DESC`;
    if (f.limit !== undefined) { sql += ' LIMIT ?'; params.push(f.limit); }
    const rows = await this.all(sql, ...params);
    return rows.map((r) => parseJson<TradeJournal>(r.data)).filter((j): j is TradeJournal => j !== null);
  }

  async deleteTradeJournal(id: string): Promise<void> {
    await this.run('DELETE FROM trade_journal WHERE id = ?', id);
  }
}
