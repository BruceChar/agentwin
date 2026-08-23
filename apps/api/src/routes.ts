import { promises as dns } from 'node:dns';
import type { FastifyInstance } from 'fastify';
import type { Interval, Market } from '@agentwin/shared';
import { runBacktest } from '@agentwin/engine';
import { builtinRegistry, normalizeParams } from '@agentwin/strategy';
import { LLMService } from '@agentwin/llm';
import { SystemIterationAgent, JournalAnalyzer, SentimentAnalyzer, StrategyAdvisor } from '@agentwin/llm';
import { createProxiedFetch } from '@agentwin/market';
import type { AppServices } from './services.ts';
import type { PaperManager } from './paper-manager.ts';

interface Body {
  [key: string]: unknown;
}

function groupByMarket(balances: { market: string; asset: string; free: number; locked: number }[], positions: { market: string; symbol: string; side: string; quantity: number; avgEntryPrice: number; unrealizedPnl: number }[]): Record<string, object> {
  const out: Record<string, object> = {};
  for (const m of ['SPOT', 'MARGIN', 'MARGIN_ISOLATED', 'USDT_M', 'COIN_M']) {
    out[m] = {
      balances: balances.filter((b) => b.market === m),
      positions: positions.filter((p) => p.market === m),
    };
  }
  return out;
}

function num(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function str(v: unknown, dflt = ''): string {
  return v === undefined ? dflt : String(v);
}

export function registerRoutes(app: FastifyInstance, services: AppServices, paper: PaperManager): void {
  const { storage, marketData, toolkit, llm, sentiment, rest, sync } = services;

  // ---------------- 健康检查 ----------------
  app.get('/api/health', async () => {
    const binance = await marketData.ping().catch((e: Error) => ({ ok: false, detail: e.message }));
    return {
      ok: true, time: Date.now(), storage: storage.engine,
      paperRunning: paper.running,
      llmModel: llm.model,
      binance,
      proxy: services.rest.proxy,
    };
  });

  // ---------------- 行情 ----------------
  app.get('/api/market/symbols', async (req) => {
    const market = str((req.query as Body)['market'], 'SPOT') as Market;
    try {
      return { symbols: await marketData.getSymbols(market) };
    } catch (e) {
      return app.httpErrors.serviceUnavailable(e instanceof Error ? e.message : String(e));
    }
  });

  app.get('/api/market/klines', async (req) => {
    const q = req.query as Body;
    const market = str(q['market'], 'SPOT') as Market;
    const interval = str(q['interval'], '1h') as Interval;
    try {
      return {
        candles: await marketData.getKlines({
          symbol: str(q['symbol'], 'BTCUSDT').toUpperCase(), market, interval,
          limit: num(q['limit'], 200), startTime: q['startTime'] !== undefined ? num(q['startTime'], 0) : undefined,
          endTime: q['endTime'] !== undefined ? num(q['endTime'], 0) : undefined,
        }),
      };
    } catch (e) {
      return app.httpErrors.serviceUnavailable(e instanceof Error ? e.message : String(e));
    }
  });

  app.get('/api/market/tickers', async (req) => {
    const market = str((req.query as Body)['market'], 'SPOT') as Market;
    try {
      return { tickers: await marketData.getTickers(market) };
    } catch (e) {
      return app.httpErrors.serviceUnavailable(e instanceof Error ? e.message : String(e));
    }
  });

  // ---------------- 账户 ----------------
  app.get('/api/accounts', async () => {
    const accounts = await storage.listAccounts();
    const out = [];
    for (const a of accounts) {
      const balances = await storage.getBalances(a.id);
      const positions = await storage.getPositions(a.id);
      const curve = await storage.getEquityCurve(a.id);
      const agg = await storage.tradeAggregates({ accountId: a.id });
      out.push({
        ...a, balances, positions,
        markets: groupByMarket(balances, positions),
        equity: curve.length > 0 ? curve[curve.length - 1]!.equity : null,
        totalTrades: agg.totalTrades, netPnl: agg.netPnl, winRate: agg.winRate,
      });
    }
    return { accounts: out };
  });

  app.post('/api/accounts', async (req) => {
    const b = (req.body ?? {}) as Body;
    const account = await storage.createAccount({
      name: str(b['name'], 'account-' + Date.now().toString(36)),
      type: (b['type'] === 'real' ? 'real' : 'paper') as 'paper' | 'real',
      meta: b['meta'] as Record<string, unknown> | undefined,
    });
    await storage.setBalance(account.id, 'USDT', num(b['initialCapital'], services.config.paperInitialCapital), 0);
    return account;
  });

  app.get('/api/accounts/:id', async (req) => {
    const id = str((req.params as Body)['id']);
    const q = req.query as Body;
    const account = await storage.getAccount(id);
    if (!account) return app.httpErrors.notFound('account not found');
    const balances = await storage.getBalances(id);
    const positions = await storage.getPositions(id);
    const curve = await storage.getEquityCurve(id);
    const agg = await storage.tradeAggregates({ accountId: id });
    const trades = await storage.listTrades({ accountId: id, market: q['market'] !== undefined ? str(q['market']) as Market : undefined, limit: num(q['limit'], 50) });
    return { account, balances, positions, markets: groupByMarket(balances, positions), equityCurve: curve, aggregates: agg, recentTrades: trades };
  });

  /**
   * 清除账户脏数据：trades=删除成交记录，equity=清空权益曲线。
   * 清除成交后自动把该账户的自动同步成交暂停（meta.syncTrades=false），防止脏数据回灌；
   * 传 syncTrades=true 可恢复自动同步成交。
   */
  app.post('/api/accounts/:id/reset', async (req) => {
    const id = str((req.params as Body)['id']);
    const account = await storage.getAccount(id);
    if (!account) return app.httpErrors.notFound('account not found');
    const b = (req.body ?? {}) as Body;
    const cleared = { trades: 0, equity: 0 };
    if (b['trades'] === true) cleared.trades = await storage.deleteTradesByAccount(id);
    if (b['equity'] === true) cleared.equity = await storage.clearEquityCurve(id);
    let syncTrades: boolean | undefined;
    if (b['syncTrades'] !== undefined) {
      syncTrades = b['syncTrades'] === true;
    } else if (b['trades'] === true) {
      syncTrades = false; // 清除成交后暂停自动同步成交
    }
    if (syncTrades !== undefined) {
      await storage.updateAccount(id, { meta: { ...(account.meta ?? {}), syncTrades } });
    }
    return { ok: true, accountId: id, cleared, syncTrades: syncTrades ?? (account.meta?.syncTrades === true) };
  });

  /**
   * 工厂重置：关闭模拟交易引擎 → 清空全部本地数据（账户/成交/权益/日志/策略等）
   * → 重新创建真实账户 → 从币安全量拉取历史成交（增量同步起点自动为最新记录）。
   * 之后每次启动/手动同步都只从最新本地记录时间往后增量拉取。
   */
  app.post('/api/admin/reset', async (req) => {
    const b = (req.body ?? {}) as Body;
    await paper.stop();
    await services.journalStore.clear();
    // 清库 + 全量重同步在同一把同步锁内原子完成（避免与启动自动同步并发产生脏数据）
    const report = await sync.resetAndFullSync({
      limitPerSymbol: num(b['limit'], 1000),
      forceTrades: true,
    });
    const accounts = await storage.listAccounts();
    return {
      ok: true,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type })),
      sync: {
        ok: report.ok,
        tradesSynced: report.tradesSynced,
        tradesSkipped: report.tradesSkipped,
        balancesUpserted: report.balancesUpserted,
        futuresPositions: report.futuresPositions,
        message: report.message,
      },
    };
  });

  // ---------------- 策略 ----------------
  app.get('/api/strategies/builtin', async () => ({ strategies: builtinRegistry.list() }));

  app.get('/api/strategies', async () => ({ strategies: await storage.listStrategies() }));

  app.post('/api/strategies', async (req) => {
    const b = (req.body ?? {}) as Body;
    const name = str(b['name']);
    if (!builtinRegistry.has(name)) return app.httpErrors.badRequest('unknown strategy kind: ' + name);
    const now = Date.now();
    const saved = await storage.createStrategy({
      id: str(b['id'], 'cfg-' + now.toString(36)),
      name, description: b['description'] !== undefined ? str(b['description']) : undefined,
      market: str(b['market'], 'SPOT') as Market,
      symbol: str(b['symbol'], 'BTCUSDT').toUpperCase(),
      interval: str(b['interval'], '1h') as Interval,
      parameters: (b['params'] as Record<string, number | string | boolean>) ?? {},
      source: (b['source'] === 'llm' ? 'llm' : 'user') as 'user' | 'llm',
      enabled: b['enabled'] === true,
      createdAt: now, updatedAt: now,
    });
    return saved;
  });

  app.get('/api/strategies/:id', async (req) => {
    const s = await storage.getStrategy(str((req.params as Body)['id']));
    if (!s) return app.httpErrors.notFound('strategy not found');
    return s;
  });

  app.patch('/api/strategies/:id', async (req) => {
    const b = (req.body ?? {}) as Body;
    const patch: Record<string, unknown> = {};
    if (b['params'] !== undefined) patch['parameters'] = b['params'];
    if (b['enabled'] !== undefined) patch['enabled'] = b['enabled'] === true;
    if (b['name'] !== undefined) patch['name'] = str(b['name']);
    const updated = await storage.updateStrategy(str((req.params as Body)['id']), patch as never);
    if (!updated) return app.httpErrors.notFound('strategy not found');
    return updated;
  });

  // ---------------- 回测 ----------------
  app.post('/api/backtest', async (req) => {
    const b = (req.body ?? {}) as Body;
    const name = str(b['strategy']);
    const strategy = builtinRegistry.create(name);
    if (!strategy) return app.httpErrors.badRequest('unknown strategy: ' + name);
    const market = str(b['market'], 'SPOT') as Market;
    const interval = str(b['interval'], '1h') as Interval;
    const symbol = str(b['symbol'], 'BTCUSDT').toUpperCase();
    const to = Date.now();
    const from = to - num(b['fromDays'], 90) * 86_400_000;
    const candles = await marketData.getKlines({ symbol, market, interval, startTime: from, endTime: to, limit: 1000 });
    if (candles.length < 50) return app.httpErrors.badRequest('not enough candles: ' + candles.length);
    const result = await runBacktest({
      strategy,
      params: (b['params'] as Record<string, number | string | boolean>) ?? {},
      symbol, market, interval, candles,
      initialCapital: num(b['initialCapital'], 10_000),
    });
    await storage.saveBacktest({
      strategyId: str(b['strategyId'], undefined as never),
      symbol, market, interval, from: result.request.from, to: result.request.to,
      initialCapital: result.request.initialCapital,
      request: result.request, result, metrics: result.metrics,
    });
    return result;
  });

  app.get('/api/backtests', async () => ({ backtests: await storage.listBacktests(20) }));
  app.get('/api/backtests/:id', async (req) => {
    const bt = await storage.getBacktest(str((req.params as Body)['id']));
    if (!bt) return app.httpErrors.notFound('backtest not found');
    return bt;
  });

  // ---------------- Paper Trading ----------------
  app.post('/api/paper/start', async (req) => {
    const b = (req.body ?? {}) as Body;
    let accountId = str(b['accountId']);
    if (!accountId) {
      const accounts = await storage.listAccounts();
      accountId = accounts.find((a) => a.type === 'paper')?.id ?? '';
    }
    if (!accountId) return app.httpErrors.badRequest('no paper account — create one first');
    const res = await paper.start({
      accountId,
      strategyId: str(b['strategyId']),
      configId: b['configId'] !== undefined ? str(b['configId']) : undefined,
      symbol: str(b['symbol'], 'BTCUSDT').toUpperCase(),
      market: str(b['market'], 'SPOT') as Market,
      interval: str(b['interval'], '1h') as Interval,
      initialCapital: num(b['initialCapital'], services.config.paperInitialCapital),
      feeRate: services.config.paperTakerFeeRate,
      slippageBps: services.config.paperSlippageBps,
    });
    return res;
  });

  app.post('/api/paper/stop', async () => paper.stop());
  app.get('/api/paper/status', async () => paper.status());

  // ---------------- Binance 真实账户（只读） ----------------
  app.get('/api/binance/status', async () => {
    const st = await sync.status();
    return { ...st, proxy: services.proxySettings.get() };
  });

  // 运行时代理开关（前端可手动切换，即时生效）
  app.get('/api/binance/proxy', async () => services.proxySettings.get());

  app.post('/api/binance/proxy', async (req) => {
    const b = (req.body ?? {}) as Body;
    try {
      return services.proxySettings.apply({ mode: b['mode'] as never, url: b['url'] !== undefined ? String(b['url']) : undefined });
    } catch (e) {
      return app.httpErrors.badRequest(e instanceof Error ? e.message : String(e));
    }
  });

  app.post('/api/binance/sync', async (req) => {
    const b = (req.body ?? {}) as Body;
    // 手动同步始终强制同步成交（绕过暂停标记）
    return sync.syncAll({
      symbols: Array.isArray(b['symbols']) ? (b['symbols'] as string[]) : [],
      limitPerSymbol: num(b['limit'], 100),
      forceTrades: true,
    });
  });

  // 代理出口连接状态（顶栏实时检测用）：代理开关 + 出口地区 + 是否受限（美国/中国等币安封锁区）
  app.get('/api/binance/proxy-status', async () => {
    const proxy = services.proxySettings.get();
    const base = { enabled: proxy.enabled, mode: proxy.mode, url: proxy.url ?? null };
    if (!proxy.enabled) return { ...base, exit: null };
    const proxiedFetch = createProxiedFetch(services.proxySettings.config);
    if (!proxiedFetch) return { ...base, exit: { success: false, error: '未配置代理' } };
    try {
      const res = await proxiedFetch('https://ipwho.is/', { signal: AbortSignal.timeout(5000) });
      const j = (await res.json()) as { ip?: string; country?: string; country_code?: string; success?: boolean };
      const country = j.country;
      const cc = j.country_code;
      const restricted = Boolean(country && (['United States', 'US', '美国'].includes(country) || cc === 'US' || country === 'China' || cc === 'CN'));
      return { ...base, exit: { success: j.success !== false, country, countryCode: cc, restricted } };
    } catch (e) {
      return { ...base, exit: { success: false, error: e instanceof Error ? e.message : String(e) } };
    }
  });

  // 网络诊断：代理出口地区 + DNS 污染对比（定位"受限地区"与"DNS 污染"）
  app.get('/api/binance/diagnose', async () => {
    const out: Record<string, unknown> = { proxy: services.proxySettings.get() };
    const proxiedFetch = createProxiedFetch(services.proxySettings.config);
    if (proxiedFetch) {
      try {
        const res = await proxiedFetch('https://ipwho.is/', { signal: AbortSignal.timeout(8000) });
        const j = (await res.json()) as { ip?: string; country?: string; country_code?: string; success?: boolean };
        out.proxyExit = { ip: j.ip, country: j.country, countryCode: j.country_code, success: j.success !== false };
      } catch (e) {
        out.proxyExit = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    try {
      const local = await dns.resolve4('api.binance.com').catch(() => ['解析失败']);
      out.dns = { local, note: 'local 应为币安真实 IP（如 99.84.x.x）；若为 Facebook/推特等地址说明 DNS 被污染' };
    } catch {
      out.dns = { local: ['解析失败'] };
    }
    return out;
  });

  app.get('/api/binance/account', async () => {
    try {
      const [spot, futures] = await Promise.all([rest.spotAccount(), rest.futuresAccount()]);
      return { spot, futures };
    } catch (e) {
      return app.httpErrors.serviceUnavailable(e instanceof Error ? e.message : String(e));
    }
  });

  app.get('/api/binance/trades', async (req) => {
    const q = req.query as Body;
    const symbol = str(q['symbol'], 'BTCUSDT').toUpperCase();
    const limit = num(q['limit'], 100);
    try {
      const [spot, futures] = await Promise.all([
        rest.myTrades('SPOT', symbol, { limit }).catch(() => []),
        rest.myTrades('USDT_M', symbol, { limit }).catch(() => []),
      ]);
      return { symbol, spot, futures };
    } catch (e) {
      return app.httpErrors.serviceUnavailable(e instanceof Error ? e.message : String(e));
    }
  });

  app.get('/api/binance/orders', async () => {
    try {
      const [spot, futures] = await Promise.all([
        rest.openOrders('SPOT').catch(() => []),
        rest.openOrders('USDT_M').catch(() => []),
      ]);
      return { spot, futures };
    } catch (e) {
      return app.httpErrors.serviceUnavailable(e instanceof Error ? e.message : String(e));
    }
  });

  // ---------------- 交易 & 盈亏 ----------------
  app.get('/api/trades', async (req) => {
    const q = req.query as Body;
    return { trades: await storage.listTrades({
      limit: num(q['limit'], 200),
      market: q['market'] !== undefined ? str(q['market']) as Market : undefined,
      accountId: q['accountId'] !== undefined ? str(q['accountId']) : undefined,
    }) };
  });

  app.get('/api/pnl', async (req) => {
    const q = req.query as Body;
    const agg = await storage.tradeAggregates({
      accountId: q['accountId'] !== undefined ? str(q['accountId']) : undefined,
      market: q['market'] !== undefined ? str(q['market']) as Market : undefined,
      from: q['from'] !== undefined ? num(q['from'], 0) : undefined,
      to: q['to'] !== undefined ? num(q['to'], 0) : undefined,
    });
    return agg;
  });

  // ---------------- LLM ----------------
  app.post('/api/llm/chat', async (req) => {
    const b = (req.body ?? {}) as Body;
    const message = str(b['message']);
    if (!message) return app.httpErrors.badRequest('message required');
    const sessionId = str(b['sessionId'], 'adv-' + Date.now().toString(36));
    let session = await storage.getSession(sessionId);
    if (!session) session = await storage.createSession({ id: sessionId, kind: 'strategy', title: message.slice(0, 40) });
    const advisor = new StrategyAdvisor(llm, toolkit, storage, session.id);
    const deltas: string[] = [];
    const reply = await advisor.ask(message, (e) => {
      if (e.type === 'text_delta' && e.delta) deltas.push(e.delta);
    });
    return { sessionId: session.id, reply, streamed: deltas.join('') };
  });

  // 流式聊天（SSE）：POST /api/llm/chat-stream
  app.post('/api/llm/chat-stream', async (req, reply) => {
    const b = (req.body ?? {}) as Body;
    const message = str(b['message']);
    if (!message) return app.httpErrors.badRequest('message required');
    const sessionId = str(b['sessionId'], 'adv-' + Date.now().toString(36));
    let session = await storage.getSession(sessionId);
    if (!session) session = await storage.createSession({ id: sessionId, kind: 'strategy', title: message.slice(0, 40) });
    const advisor = new StrategyAdvisor(llm, toolkit, storage, session.id);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (data: unknown) => {
      raw.write('data: ' + JSON.stringify(data) + '\n\n');
    };
    send({ type: 'session', sessionId: session.id });
    try {
      await advisor.ask(message, (e) => {
        if (e.type === 'text_delta' && e.delta) send({ type: 'delta', delta: e.delta });
        else if (e.type === 'toolcall_end') send({ type: 'tool', name: e.toolName ?? '' });
      });
      send({ type: 'done', sessionId: session.id });
    } catch (e) {
      send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      raw.end();
    }
    return reply;
  });

  app.get('/api/llm/sessions', async () => ({ sessions: await storage.listSessions() }));
  app.get('/api/llm/sessions/:id/messages', async (req) => {
    return { messages: await storage.listMessages(str((req.params as Body)['id'])) };
  });

  app.post('/api/llm/iterate', async (req) => {
    const b = (req.body ?? {}) as Body;
    const strategyId = str(b['strategyId']);
    const config = strategyId ? await storage.getStrategy(strategyId) : null;
    if (!config) return app.httpErrors.badRequest('strategy config not found: ' + strategyId);
    const strategy = builtinRegistry.create(config.name);
    if (!strategy) return app.httpErrors.badRequest('unknown strategy kind: ' + config.name);
    const to = Date.now();
    const from = to - num(b['fromDays'], 60) * 86_400_000;
    const candles = await marketData.getKlines({ symbol: config.symbol, market: config.market, interval: config.interval, startTime: from, endTime: to, limit: 1000 });
    const result = await runBacktest({
      strategy, params: config.parameters, symbol: config.symbol, market: config.market,
      interval: config.interval, candles, initialCapital: num(b['initialCapital'], 10_000),
    });
    const journal = await storage.listJournalEntries({ limit: 20 });
    const agent = new SystemIterationAgent(llm);
    const proposal = await agent.propose({
      strategy: { id: config.name, name: config.name, params: config.parameters },
      backtest: {
        totalReturn: result.metrics.totalReturn, maxDrawdown: result.metrics.maxDrawdown,
        sharpe: result.metrics.sharpe, winRate: result.metrics.winRate,
        profitFactor: result.metrics.profitFactor, totalTrades: result.metrics.totalTrades,
        recentTrades: result.trades.slice(-5).map((t) => ({ side: t.side, pnl: t.pnl, reason: t.reason })),
      },
      journal: journal.map((j) => ({ title: j.title, body: j.body, tags: j.tags })),
    });
    return { backtestRunId: result.runId, metrics: result.metrics, proposal };
  });

  app.post('/api/llm/analyze-journal', async (req) => {
    const b = (req.body ?? {}) as Body;
    const trades = await storage.listTrades({ limit: num(b['tradeLimit'], 50) });
    const journal = await storage.listJournalEntries({ limit: num(b['journalLimit'], 20) });
    const agent = new JournalAnalyzer(llm);
    const analysis = await agent.analyze({
      trades: trades.map((t) => ({ symbol: t.symbol, side: t.side, pnl: t.realizedPnl, reason: 'fill' })),
      journalEntries: journal,
    });
    return analysis;
  });

  // ---------------- 舆情 ----------------
  app.post('/api/sentiment/scan', async (req) => {
    const b = (req.body ?? {}) as Body;
    const symbol = str(b['symbol'], 'BTCUSDT').toUpperCase();
    const res = await sentiment.scan(symbol, { useLLM: b['useLLM'] === true });
    return res;
  });

  app.post('/api/sentiment/score', async (req) => {
    const b = (req.body ?? {}) as Body;
    const symbol = str(b['symbol'], 'BTCUSDT').toUpperCase();
    const rec = await sentiment.scanManual(symbol, str(b['headline']), b['body'] !== undefined ? str(b['body']) : undefined, true);
    return rec;
  });

  app.get('/api/sentiment/:symbol', async (req) => {
    const symbol = str((req.params as Body)['symbol']).toUpperCase();
    return sentiment.aggregate(symbol, num((req.query as Body)['hours'], 24));
  });

  // ---------------- 存储路径设置 ----------------
  // 当前存储路径（JSONL 主存储 / SQLite 辅助库，绝对路径）
  app.get('/api/settings/storage', async () => services.storageSettings.get());

  // 修改主存储路径：目录输入自动补 trade-journal.jsonl；即时迁移内存记录并持久化，重启后继续生效
  app.post('/api/settings/storage', async (req) => {
    const b = (req.body ?? {}) as Body;
    let next: string;
    try {
      next = services.storageSettings.normalize(str(b['journalPath']));
    } catch (e) {
      return app.httpErrors.badRequest(e instanceof Error ? e.message : String(e));
    }
    try {
      await services.journalStore.move(next);
    } catch (e) {
      return app.httpErrors.badRequest('存储路径不可用：' + (e instanceof Error ? e.message : String(e)));
    }
    return services.storageSettings.save(next);
  });

  // ---------------- 交易日志 ----------------
  app.get('/api/journal', async (req) => {
    const q = req.query as Body;
    return { entries: await storage.listJournalEntries({ limit: num(q['limit'], 50) }) };
  });

  app.post('/api/journal', async (req) => {
    const b = (req.body ?? {}) as Body;
    const entry = await storage.createJournalEntry({
      kind: (['trade', 'insight', 'review', 'note'].includes(str(b['kind'])) ? str(b['kind']) : 'note') as 'note',
      title: str(b['title'], '无标题'),
      body: str(b['body']),
      tags: Array.isArray(b['tags']) ? (b['tags'] as string[]) : [],
    });
    return entry;
  });

  // ---------------- 结构化交易日志（JSONL 主存储 + SQLite 镜像） ----------------
  const tj = services.journalStore;
  const tjFill = services.journalAutoFill;

  // 统计（先注册，避免被 :id 捕获）
  app.get('/api/journal/trades/stats', async (req) => {
    const q = req.query as Body;
    return tj.stats({
      symbol: q['symbol'] !== undefined ? str(q['symbol']) : undefined,
      market: q['market'] !== undefined ? str(q['market']) : undefined,
      tag: q['tag'] !== undefined ? str(q['tag']) : undefined,
      accountId: q['accountId'] !== undefined ? str(q['accountId']) : undefined,
      from: q['from'] !== undefined ? num(q['from'], 0) : undefined,
      to: q['to'] !== undefined ? num(q['to'], 0) : undefined,
    });
  });

  app.get('/api/journal/trades', async (req) => {
    const q = req.query as Body;
    return { records: tj.list({
      symbol: q['symbol'] !== undefined ? str(q['symbol']) : undefined,
      market: q['market'] !== undefined ? str(q['market']) : undefined,
      tag: q['tag'] !== undefined ? str(q['tag']) : undefined,
      accountId: q['accountId'] !== undefined ? str(q['accountId']) : undefined,
      from: q['from'] !== undefined ? num(q['from'], 0) : undefined,
      to: q['to'] !== undefined ? num(q['to'], 0) : undefined,
      limit: num(q['limit'], 100),
    }) };
  });

  // 仅自动计算（不保存），供前端"自动计算"按钮预览
  app.post('/api/journal/trades/autofill', async (req) => {
    const b = (req.body ?? {}) as Body;
    const res = await tjFill.fill((b['record'] ?? {}) as never);
    return res;
  });

  app.post('/api/journal/trades', async (req) => {
    const b = (req.body ?? {}) as Body;
    const input = (b['record'] ?? {}) as Record<string, unknown>;
    const useAuto = b['autofill'] === true;
    let record = input;
    const notes: string[] = [];
    if (useAuto) {
      const res = await tjFill.fill(input as never);
      record = res.record as Record<string, unknown>;
      notes.push(...res.notes);
    }
    const journal = await tj.create({
      ...record,
      symbol: str(record['symbol'], 'BTCUSDT').toUpperCase(),
      direction: (record['direction'] === 'SHORT' ? 'SHORT' : 'LONG') as 'LONG' | 'SHORT',
      tradeNo: str(record['tradeNo'], 'T' + Date.now().toString(36)),
      market: str(record['market'], 'U本位合约'),
      tags: Array.isArray(record['tags']) ? (record['tags'] as string[]) : [],
    } as never);
    return { journal, notes };
  });

  app.get('/api/journal/trades/:id', async (req) => {
    const j = tj.get(str((req.params as Body)['id']));
    if (!j) return app.httpErrors.notFound('trade journal not found');
    return j;
  });

  app.patch('/api/journal/trades/:id', async (req) => {
    const b = (req.body ?? {}) as Body;
    const id = str((req.params as Body)['id']);
    const patch = (b['patch'] ?? {}) as Record<string, unknown>;
    const useAuto = b['autofill'] === true;
    let merged = patch;
    const notes: string[] = [];
    if (useAuto) {
      const cur = tj.get(id);
      const res = await tjFill.fill({ ...cur, ...patch } as never);
      merged = res.record as Record<string, unknown>;
      notes.push(...res.notes);
    }
    const updated = await tj.update(id, merged as never);
    if (!updated) return app.httpErrors.notFound('trade journal not found');
    return { journal: updated, notes };
  });

  app.delete('/api/journal/trades/:id', async (req) => {
    const ok = await tj.remove(str((req.params as Body)['id']));
    return { deleted: ok };
  });
}
