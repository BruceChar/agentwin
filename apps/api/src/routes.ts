import type { FastifyInstance } from 'fastify';
import type { Interval, Market } from '@agentwin/shared';
import { runBacktest } from '@agentwin/engine';
import { builtinRegistry, normalizeParams } from '@agentwin/strategy';
import { LLMService } from '@agentwin/llm';
import { SystemIterationAgent, JournalAnalyzer, SentimentAnalyzer, StrategyAdvisor } from '@agentwin/llm';
import type { AppServices } from './services.ts';
import type { PaperManager } from './paper-manager.ts';

interface Body {
  [key: string]: unknown;
}

function num(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function str(v: unknown, dflt = ''): string {
  return v === undefined ? dflt : String(v);
}

export function registerRoutes(app: FastifyInstance, services: AppServices, paper: PaperManager): void {
  const { storage, marketData, toolkit, llm, sentiment } = services;

  // ---------------- 健康检查 ----------------
  app.get('/api/health', async () => ({
    ok: true, time: Date.now(), storage: storage.engine,
    paperRunning: paper.running,
    llmModel: llm.model,
  }));

  // ---------------- 行情 ----------------
  app.get('/api/market/symbols', async (req) => {
    const market = str((req.query as Body)['market'], 'SPOT') as Market;
    return { symbols: await marketData.getSymbols(market) };
  });

  app.get('/api/market/klines', async (req) => {
    const q = req.query as Body;
    const market = str(q['market'], 'SPOT') as Market;
    const interval = str(q['interval'], '1h') as Interval;
    return {
      candles: await marketData.getKlines({
        symbol: str(q['symbol'], 'BTCUSDT').toUpperCase(), market, interval,
        limit: num(q['limit'], 200), startTime: q['startTime'] !== undefined ? num(q['startTime'], 0) : undefined,
        endTime: q['endTime'] !== undefined ? num(q['endTime'], 0) : undefined,
      }),
    };
  });

  app.get('/api/market/tickers', async (req) => {
    const market = str((req.query as Body)['market'], 'SPOT') as Market;
    return { tickers: await marketData.getTickers(market) };
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
        equity: curve.length > 0 ? curve[curve.length - 1]!.equity : null,
        totalTrades: agg.totalTrades, netPnl: agg.netPnl, winRate: agg.winRate,
      });
    }
    return { accounts: out };
  });

  app.post('/api/accounts', async (req) => {
    const b = req.body as Body;
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
    const account = await storage.getAccount(id);
    if (!account) return app.httpErrors.notFound('account not found');
    const balances = await storage.getBalances(id);
    const positions = await storage.getPositions(id);
    const curve = await storage.getEquityCurve(id);
    const agg = await storage.tradeAggregates({ accountId: id });
    const trades = await storage.listTrades({ accountId: id, limit: 50 });
    return { account, balances, positions, equityCurve: curve, aggregates: agg, recentTrades: trades };
  });

  // ---------------- 策略 ----------------
  app.get('/api/strategies/builtin', async () => ({ strategies: builtinRegistry.list() }));

  app.get('/api/strategies', async () => ({ strategies: await storage.listStrategies() }));

  app.post('/api/strategies', async (req) => {
    const b = req.body as Body;
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
    const b = req.body as Body;
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
    const b = req.body as Body;
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
    const b = req.body as Body;
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

  // ---------------- 交易 & 盈亏 ----------------
  app.get('/api/trades', async (req) => {
    const q = req.query as Body;
    return { trades: await storage.listTrades({ limit: num(q['limit'], 100) }) };
  });

  app.get('/api/pnl', async (req) => {
    const q = req.query as Body;
    const agg = await storage.tradeAggregates({ accountId: q['accountId'] !== undefined ? str(q['accountId']) : undefined });
    return agg;
  });

  // ---------------- LLM ----------------
  app.post('/api/llm/chat', async (req) => {
    const b = req.body as Body;
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
    const b = req.body as Body;
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
    const b = req.body as Body;
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
    const b = req.body as Body;
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
    const b = req.body as Body;
    const symbol = str(b['symbol'], 'BTCUSDT').toUpperCase();
    const res = await sentiment.scan(symbol, { useLLM: b['useLLM'] === true });
    return res;
  });

  app.post('/api/sentiment/score', async (req) => {
    const b = req.body as Body;
    const symbol = str(b['symbol'], 'BTCUSDT').toUpperCase();
    const rec = await sentiment.scanManual(symbol, str(b['headline']), b['body'] !== undefined ? str(b['body']) : undefined, true);
    return rec;
  });

  app.get('/api/sentiment/:symbol', async (req) => {
    const symbol = str((req.params as Body)['symbol']).toUpperCase();
    return sentiment.aggregate(symbol, num((req.query as Body)['hours'], 24));
  });

  // ---------------- 交易日志 ----------------
  app.get('/api/journal', async (req) => {
    const q = req.query as Body;
    return { entries: await storage.listJournalEntries({ limit: num(q['limit'], 50) }) };
  });

  app.post('/api/journal', async (req) => {
    const b = req.body as Body;
    const entry = await storage.createJournalEntry({
      kind: (['trade', 'insight', 'review', 'note'].includes(str(b['kind'])) ? str(b['kind']) : 'note') as 'note',
      title: str(b['title'], '无标题'),
      body: str(b['body']),
      tags: Array.isArray(b['tags']) ? (b['tags'] as string[]) : [],
    });
    return entry;
  });
}
