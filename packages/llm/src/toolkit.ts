import { Type } from '@earendil-works/pi-ai';
import type { Tool } from '@earendil-works/pi-ai';
import type { BacktestResult, Interval, Market, StrategyParamValue, Trade, TradeAggregates } from '@agentwin/shared';
import type { StorageAdapter } from '@agentwin/db';
import type { MarketDataProvider } from '@agentwin/market';
import type { StrategyRegistry } from '@agentwin/strategy';
import { runBacktest } from '@agentwin/engine';

export interface ToolkitDeps {
  storage: StorageAdapter;
  marketData: MarketDataProvider;
  strategyRegistry: StrategyRegistry;
  /** 默认账户（paper） */
  accountId?: string;
}

/**
 * 交易工具箱：把系统能力（行情/回测/账户/策略/舆情/日志）暴露为 LLM 可调用的工具。
 * LLM 通过工具调用获取真实数据并推理，再生成策略建议（create_strategy 保存为未启用草稿）。
 */
export class TradingToolkit {
  private readonly deps: ToolkitDeps;

  constructor(deps: ToolkitDeps) {
    this.deps = deps;
  }

  private async accountId(): Promise<string> {
    if (this.deps.accountId) return this.deps.accountId;
    const accounts = await this.deps.storage.listAccounts();
    const paper = accounts.find((a) => a.type === 'paper');
    if (!paper) throw new Error('no paper account — create one first');
    return paper.id;
  }

  // ================= 工具函数 =================

  async getKlines(args: { symbol: string; market: Market; interval: Interval; limit?: number }): Promise<object> {
    const candles = await this.deps.marketData.getKlines({
      symbol: args.symbol, market: args.market, interval: args.interval, limit: Math.min(args.limit ?? 200, 500),
    });
    const closes = candles.map((c) => c.close);
    return {
      symbol: args.symbol, market: args.market, interval: args.interval, bars: candles.length,
      from: candles[0]?.openTime, to: candles[candles.length - 1]?.openTime,
      lastClose: closes[closes.length - 1],
      recentCloses: closes.slice(-20),
      summary: {
        mean: avg(closes), min: Math.min(...closes), max: Math.max(...closes),
        last24hChangePct: closes.length > 1 ? (closes[closes.length - 1]! / closes[closes.length - 2]! - 1) * 100 : 0,
      },
    };
  }

  async runBacktest(args: {
    strategy: string; params?: Record<string, number | string | boolean>;
    symbol: string; market: Market; interval: Interval;
    fromDays?: number; toDays?: number; initialCapital?: number;
  }): Promise<object> {
    const strategy = this.deps.strategyRegistry.create(args.strategy);
    if (!strategy) return { error: 'unknown strategy: ' + args.strategy + ' — use list_strategies' };
    const to = Date.now();
    const from = to - (args.fromDays ?? 90) * 86_400_000;
    const candles = await this.deps.marketData.getKlines({
      symbol: args.symbol, market: args.market, interval: args.interval,
      startTime: from, endTime: to, limit: 1000,
    });
    if (candles.length < 50) return { error: 'not enough candles (' + candles.length + ') — try larger fromDays or smaller interval' };
    const result: BacktestResult = await runBacktest({
      strategy, params: args.params ?? {},
      symbol: args.symbol, market: args.market, interval: args.interval,
      candles, initialCapital: args.initialCapital ?? 10_000,
    });
    return {
      runId: result.runId,
      metrics: result.metrics,
      trades: result.trades.slice(-10).map((t) => ({
        side: t.side, entryPrice: round2(t.entryPrice), exitPrice: round2(t.exitPrice),
        pnl: round2(t.pnl), pnlPct: round2(t.pnlPct * 100) + '%', reason: t.reason, holdBars: t.holdBars,
      })),
      equitySamples: result.equityCurve.filter((_, i) => i % Math.max(1, Math.floor(result.equityCurve.length / 20)) === 0)
        .map((p) => ({ t: p.timestamp, equity: round2(p.equity) })),
    };
  }

  async getAccount(): Promise<object> {
    const accountId = await this.accountId();
    const account = await this.deps.storage.getAccount(accountId);
    const balances = await this.deps.storage.getBalances(accountId);
    const positions = await this.deps.storage.getPositions(accountId);
    const curve = await this.deps.storage.getEquityCurve(accountId, undefined, undefined);
    const last = curve[curve.length - 1];
    const agg = await this.deps.storage.tradeAggregates({ accountId });
    return {
      account: account?.name, type: account?.type, currency: account?.currency,
      equity: last ? round2(last.equity) : null, cash: last ? round2(last.cash) : null,
      unrealizedPnl: last ? round2(last.unrealizedPnl) : null,
      balances: balances.map((b) => ({ asset: b.asset, free: round2(b.free) })),
      positions: positions.map((p) => ({ symbol: p.symbol, side: p.side, qty: round2(p.quantity), avgEntry: round2(p.avgEntryPrice), unrealizedPnl: round2(p.unrealizedPnl) })),
      pnl: summarizeAgg(agg),
    };
  }

  async getTrades(args: { limit?: number }): Promise<object> {
    const accountId = await this.accountId();
    const trades = await this.deps.storage.listTrades({ accountId, limit: args.limit ?? 20 });
    return { trades: trades.map((t: Trade) => ({
      symbol: t.symbol, side: t.side, qty: round2(t.qty), price: round2(t.price),
      pnl: t.realizedPnl !== undefined ? round2(t.realizedPnl) : null, at: t.tradedAt, strategy: t.strategyId,
    })) };
  }

  async getPnl(): Promise<object> {
    const accountId = await this.accountId();
    const agg: TradeAggregates = await this.deps.storage.tradeAggregates({ accountId });
    return { ...summarizeAgg(agg), bySymbol: Object.fromEntries(Object.entries(agg.bySymbol).map(([k, v]) => [k, { trades: v.trades, netPnl: round2(v.netPnl), winRate: round2(v.winRate * 100) + '%' }])) };
  }

  async listStrategies(): Promise<object> {
    const metas = this.deps.strategyRegistry.list();
    const configs = await this.deps.storage.listStrategies();
    return {
      builtin: metas.map((m) => ({ id: m.id, name: m.name, description: m.description, params: m.paramSpecs.map((p) => ({ name: p.name, default: p.default, min: p.min, max: p.max })) })),
      saved: configs.map((c) => ({ id: c.id, name: c.name, symbol: c.symbol, market: c.market, interval: c.interval, params: c.parameters, source: c.source, enabled: c.enabled })),
    };
  }

  async getSentiment(args: { symbol: string; limit?: number }): Promise<object> {
    const records = await this.deps.storage.listSentiment({ symbol: args.symbol.toUpperCase(), limit: args.limit ?? 10 });
    const avg = records.length > 0 ? records.reduce((a, r) => a + r.score, 0) / records.length : 0;
    return {
      symbol: args.symbol.toUpperCase(), averageScore: round2(avg),
      records: records.map((r) => ({ source: r.source, headline: r.headline, score: r.score, label: r.label, at: r.createdAt })),
    };
  }

  /** 保存 LLM 生成的策略草稿（默认不启用，需人工确认） */
  async createStrategy(args: {
    strategy: string; params?: Record<string, StrategyParamValue>;
    symbol: string; market: Market; interval: Interval; description?: string;
  }): Promise<object> {
    if (!this.deps.strategyRegistry.has(args.strategy)) return { error: 'unknown strategy kind: ' + args.strategy };
    const now = Date.now();
    const saved = await this.deps.storage.createStrategy({
      id: 'llm-' + now.toString(36),
      name: args.strategy,
      description: args.description ?? 'LLM 生成',
      market: args.market, symbol: args.symbol.toUpperCase(), interval: args.interval,
      parameters: args.params ?? {}, source: 'llm', enabled: false,
      createdAt: now, updatedAt: now,
    });
    return { created: true, id: saved.id, name: saved.name, enabled: false, note: '策略已保存为草稿，启用后才会参与 paper trading' };
  }

  async setStrategyEnabled(args: { id: string; enabled: boolean }): Promise<object> {
    const updated = await this.deps.storage.updateStrategy(args.id, { enabled: args.enabled });
    if (!updated) return { error: 'strategy not found: ' + args.id };
    return { updated: true, id: updated.id, enabled: updated.enabled };
  }

  async addJournal(args: { kind: string; title: string; body: string; tags?: string[] }): Promise<object> {
    const accountId = await this.accountId();
    const entry = await this.deps.storage.createJournalEntry({
      accountId, kind: (args.kind as 'trade' | 'insight' | 'review' | 'note') ?? 'note',
      title: args.title, body: args.body, tags: args.tags ?? [],
    });
    return { created: true, id: entry.id };
  }

  // ================= pi-ai Tool 定义 =================

  tools(): Tool[] {
    return [
      {
        name: 'get_klines', description: '获取最近 K 线（含统计摘要），用于分析行情', 
        parameters: Type.Object({
          symbol: Type.String({ description: '交易对，如 BTCUSDT' }),
          market: Type.Union([Type.Literal('SPOT'), Type.Literal('USDT_M')], { description: '市场：现货或 U 本位合约' }),
          interval: Type.Union([Type.Literal('1h'), Type.Literal('4h'), Type.Literal('1d')], { description: 'K 线周期' }),
          limit: Type.Optional(Type.Integer({ description: 'K 线数量', minimum: 10, maximum: 500 })),
        }),
      },
      {
        name: 'run_backtest', description: '对指定策略与参数在历史行情上回测，返回绩效指标与成交明细',
        parameters: Type.Object({
          strategy: Type.String({ description: '内置策略 id（如 ma_cross、rsi、bollinger、grid、dca、macd_trend）' }),
          params: Type.Optional(Type.Record(Type.String(), Type.Union([Type.Number(), Type.String(), Type.Boolean()]), { description: '策略参数，覆盖默认值' })),
          symbol: Type.String({ description: '交易对，如 BTCUSDT' }),
          market: Type.Union([Type.Literal('SPOT'), Type.Literal('USDT_M')]),
          interval: Type.Union([Type.Literal('1h'), Type.Literal('4h'), Type.Literal('1d')]),
          fromDays: Type.Optional(Type.Integer({ description: '回测起始天数（往前推）', minimum: 7, maximum: 1095 })),
          initialCapital: Type.Optional(Type.Number({ description: '初始资金，默认 10000 USDT' })),
        }),
      },
      {
        name: 'get_account', description: '查看模拟账户权益、现金、持仓与盈亏汇总',
        parameters: Type.Object({}),
      },
      {
        name: 'get_trades', description: '查看最近的模拟成交记录',
        parameters: Type.Object({ limit: Type.Optional(Type.Integer({ maximum: 100 })) }),
      },
      {
        name: 'get_pnl', description: '查看盈亏统计（胜率、盈亏比、净盈亏、按币种拆分）',
        parameters: Type.Object({}),
      },
      {
        name: 'list_strategies', description: '列出可用内置策略与已保存的策略配置',
        parameters: Type.Object({}),
      },
      {
        name: 'get_sentiment', description: '查看某币种最近的舆情打分记录',
        parameters: Type.Object({ symbol: Type.String(), limit: Type.Optional(Type.Integer({ maximum: 50 })) }),
      },
      {
        name: 'create_strategy', description: '把推荐的策略保存为草稿（不会自动启用），需要用户确认后启用',
        parameters: Type.Object({
          strategy: Type.String({ description: '内置策略 id' }),
          params: Type.Optional(Type.Record(Type.String(), Type.Union([Type.Number(), Type.String(), Type.Boolean()]))),
          symbol: Type.String(), market: Type.Union([Type.Literal('SPOT'), Type.Literal('USDT_M')]),
          interval: Type.Union([Type.Literal('1h'), Type.Literal('4h'), Type.Literal('1d')]),
          description: Type.Optional(Type.String({ description: '调整理由' })),
        }),
      },
      {
        name: 'set_strategy_enabled', description: '启用/停用某个已保存的策略',
        parameters: Type.Object({ id: Type.String(), enabled: Type.Boolean() }),
      },
      {
        name: 'add_journal', description: '记录交易心得/复盘到日志',
        parameters: Type.Object({
          kind: Type.Union([Type.Literal('trade'), Type.Literal('insight'), Type.Literal('review'), Type.Literal('note')]),
          title: Type.String(), body: Type.String(), tags: Type.Optional(Type.Array(Type.String())),
        }),
      },
    ];
  }
}

function avg(v: number[]): number {
  return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function summarizeAgg(agg: TradeAggregates): object {
  return {
    totalTrades: agg.totalTrades, wins: agg.wins, losses: agg.losses,
    winRate: round2(agg.winRate * 100) + '%', netPnl: round2(agg.netPnl),
    grossProfit: round2(agg.grossProfit), grossLoss: round2(agg.grossLoss),
    profitFactor: agg.profitFactor === Infinity ? 'Inf' : round2(agg.profitFactor),
    feesPaid: round2(agg.feesPaid),
  };
}
