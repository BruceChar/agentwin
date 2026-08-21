import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorage } from '@agentwin/db';
import { MockMarketData } from '@agentwin/market';
import { TradeJournalStore } from '../src/journal-store.ts';
import { JournalAutoFill } from '../src/journal-autofill.ts';

describe('TradeJournalStore (JSONL primary + SQLite mirror)', () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;
  let store: TradeJournalStore;

  beforeEach(async () => {
    storage = createStorage({ engine: 'sqlite', path: ':memory:' });
    await storage.init();
    dir = mkdtempSync(join(tmpdir(), 'aw-journal-'));
    store = new TradeJournalStore(join(dir, 'trade-journal.jsonl'), storage);
    await store.init();
  });

  afterEach(async () => {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates records, persists JSONL, and reloads from JSONL', async () => {
    const j1 = await store.create({
      tradeNo: '20260821-001', symbol: 'BTCUSDT', market: 'U本位合约', direction: 'LONG',
      strategyVersion: '趋势跟踪 v2.3', planExecution: 'complete',
      actualEntry: 70000, actualExit: 71000, actualQty: 0.1, netPnl: 90, tags: ['正常盈利'],
    } as never);
    const j2 = await store.create({
      tradeNo: '20260821-002', symbol: 'ETHUSDT', market: '现货', direction: 'LONG',
      planExecution: 'partial', actualEntry: 2000, actualExit: 1950, actualQty: 2, netPnl: -110, tags: ['执行错误'],
    } as never);

    const jsonl = readFileSync(join(dir, 'trade-journal.jsonl'), 'utf8');
    expect(jsonl.split('\n').filter(Boolean)).toHaveLength(2);

    // SQLite 镜像
    const mirrored = await storage.listTradeJournals({});
    expect(mirrored.length).toBe(2);

    // 重新加载（从 JSONL）
    const store2 = new TradeJournalStore(join(dir, 'trade-journal.jsonl'), storage);
    await store2.init();
    expect(store2.get(j1.id)?.tradeNo).toBe('20260821-001');
    expect(store2.list().length).toBe(2);

    // 统计
    const stats = store2.stats();
    expect(stats.total).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(0.5);
    expect(stats.netPnl).toBeCloseTo(-20, 5);
    expect(stats.tagFrequency['执行错误']).toBe(1);
    expect(stats.planDeviation.partial).toBe(1);
    expect(stats.byStrategy['趋势跟踪 v2.3']?.netPnl).toBe(90);
  });

  it('update rewrites JSONL and mirrors', async () => {
    const j = await store.create({
      tradeNo: 'T1', symbol: 'BTCUSDT', market: 'U本位合约', direction: 'LONG',
      planExecution: 'complete', tags: [],
    } as never);
    await store.update(j.id, { netPnl: 123, tags: ['正常盈利'], disciplineScore: 9 });
    const after = store.get(j.id)!;
    expect(after.netPnl).toBe(123);
    expect(after.disciplineScore).toBe(9);
    expect(readFileSync(join(dir, 'trade-journal.jsonl'), 'utf8')).toContain('"netPnl":123');
    expect((await storage.getTradeJournal(j.id))?.netPnl).toBe(123);
    // 删除
    await store.remove(j.id);
    expect(store.list()).toHaveLength(0);
    expect(await storage.getTradeJournal(j.id)).toBeNull();
  });

  it('recovers from SQLite mirror when JSONL missing', async () => {
    const j = await store.create({
      tradeNo: 'T1', symbol: 'BTCUSDT', market: '现货', direction: 'LONG',
      planExecution: 'complete', tags: [],
    } as never);
    rmSync(join(dir, 'trade-journal.jsonl'), { force: true });
    const store2 = new TradeJournalStore(join(dir, 'trade-journal.jsonl'), storage);
    await store2.init();
    expect(store2.get(j.id)?.symbol).toBe('BTCUSDT');
    expect(readFileSync(join(dir, 'trade-journal.jsonl'), 'utf8')).toContain('T1');
  });
});

describe('JournalAutoFill', () => {
  it('computes pnl / R / holding duration / MFE/MAE / indicators from market data', async () => {
    const marketData = new MockMarketData(7);
    await marketData.init();
    const fill = new JournalAutoFill(marketData);
    const now = Date.now();
    const openTime = now - 5 * 3_600_000;
    const closeTime = now - 1 * 3_600_000;
    const res = await fill.fill({
      symbol: 'BTCUSDT', market: 'U本位合约', direction: 'LONG',
      actualEntry: 60000, actualExit: 61000, actualQty: 1, plannedRiskAmount: 500,
      openTime, closeTime,
    });
    expect(res.record.netPnl).toBeGreaterThan(800); // (61000-60000)*1 - 双边费用约121
    expect(res.record.rMultiple).toBeGreaterThan(1);
    expect(res.record.holdingDuration).toMatch(/小时/);
    expect(res.record.mfe).toBeGreaterThanOrEqual(0);
    expect(res.record.mae).toBeGreaterThanOrEqual(0);
    expect(res.record.indicators?.['rsi14']).toBeDefined();
    expect(res.record.volatility).toContain('ATR');
    expect(res.notes.length).toBeGreaterThan(0);
    await marketData.close();
  });
});
