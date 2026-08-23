import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StorageAdapter } from '@agentwin/db';
import type { NewTradeJournal, TradeJournal, TradeJournalStats } from '@agentwin/shared';

export interface TradeJournalFilter {
  accountId?: string;
  symbol?: string;
  market?: string;
  tag?: string;
  from?: number;
  to?: number;
  limit?: number;
}

/**
 * 结构化交易日志仓库：
 * - **JSONL 为主存储**（data/trade-journal.jsonl，每行一条，便于备份/迁移/版本管理）；
 * - SQLite 为辅助镜像（快速查询/统计；JSONL 丢失时可用镜像恢复）。
 */
export class TradeJournalStore {
  private records = new Map<string, TradeJournal>();
  private filePath: string;
  private readonly storage: StorageAdapter;

  constructor(filePath: string, storage: StorageAdapter) {
    this.filePath = filePath;
    this.storage = storage;
  }

  /** 启动加载：JSONL 优先，缺失则从 SQLite 镜像恢复 */
  async init(): Promise<void> {
    if (existsSync(this.filePath)) {
      for (const line of readFileSync(this.filePath, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const j = JSON.parse(t) as TradeJournal;
          if (j && j.id) this.records.set(j.id, j);
        } catch {
          /* 跳过损坏行 */
        }
      }
      return;
    }
    const mirrored = await this.storage.listTradeJournals({ limit: 100_000 });
    for (const j of mirrored) this.records.set(j.id, j);
    this.persistJsonl();
  }

  private persistJsonl(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const lines = [...this.records.values()]
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .map((j) => JSON.stringify(j));
    writeFileSync(this.filePath, lines.length ? lines.join('\n') + '\n' : '');
  }

  /** 当前 JSONL 主存储文件路径（绝对/相对均按构造时的原样） */
  get path(): string {
    return this.filePath;
  }

  /** 迁移主存储到新路径：把内存中的全部记录写入新文件，之后的写入都走新路径 */
  async move(newPath: string): Promise<void> {
    this.filePath = newPath;
    this.persistJsonl();
  }

  async create(input: NewTradeJournal & { id?: string }): Promise<TradeJournal> {
    const now = Date.now();
    const j: TradeJournal = {
      ...input, id: input.id ?? randomUUID(),
      planExecution: input.planExecution ?? 'complete',
      tags: input.tags ?? [],
      createdAt: now, updatedAt: now,
    } as TradeJournal;
    this.records.set(j.id, j);
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, JSON.stringify(j) + '\n', 'utf8');
    await this.storage.upsertTradeJournal(j);
    return j;
  }

  async update(id: string, patch: Partial<TradeJournal>): Promise<TradeJournal | null> {
    const cur = this.records.get(id);
    if (!cur) return null;
    const next: TradeJournal = { ...cur, ...patch, id, updatedAt: Date.now() };
    this.records.set(id, next);
    this.persistJsonl();
    await this.storage.upsertTradeJournal(next);
    return next;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.records.delete(id)) return false;
    this.persistJsonl();
    await this.storage.deleteTradeJournal(id);
    return true;
  }

  /** 清空全部交易日志（内存 + JSONL 文件 + SQLite 镜像） */
  async clear(): Promise<void> {
    this.records.clear();
    this.persistJsonl();
    // SQLite 镜像由 wipeAll 一并清空
  }

  get(id: string): TradeJournal | null {
    return this.records.get(id) ?? null;
  }

  list(filter: TradeJournalFilter = {}): TradeJournal[] {
    let out = [...this.records.values()];
    if (filter.accountId) out = out.filter((j) => j.accountId === filter.accountId);
    if (filter.symbol) out = out.filter((j) => j.symbol.toUpperCase().includes(filter.symbol!.toUpperCase()));
    if (filter.market) out = out.filter((j) => j.market === filter.market);
    if (filter.tag) out = out.filter((j) => j.tags.includes(filter.tag!));
    if (filter.from !== undefined) out = out.filter((j) => (j.closeTime ?? j.createdAt) >= filter.from!);
    if (filter.to !== undefined) out = out.filter((j) => (j.closeTime ?? j.createdAt) <= filter.to!);
    out.sort((a, b) => (b.closeTime ?? b.createdAt) - (a.closeTime ?? a.createdAt));
    if (filter.limit !== undefined) out = out.slice(0, filter.limit);
    return out;
  }

  /** 统计（迭代交易系统用：胜率/盈亏比/平均R/期望值/规则符合度/标签频率/按策略与市场分组） */
  stats(filter: TradeJournalFilter = {}): TradeJournalStats {
    const all = this.list(filter);
    const closed = all.filter((j) => j.netPnl !== undefined);
    const wins = closed.filter((j) => (j.netPnl ?? 0) > 0);
    const losses = closed.filter((j) => (j.netPnl ?? 0) < 0);
    const grossProfit = wins.reduce((a, j) => a + (j.netPnl ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((a, j) => a + (j.netPnl ?? 0), 0));
    const rs = closed.map((j) => j.rMultiple).filter((r): r is number => r !== undefined && Number.isFinite(r));
    const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
    const tagFrequency: Record<string, number> = {};
    for (const j of all) for (const t of j.tags ?? []) tagFrequency[t] = (tagFrequency[t] ?? 0) + 1;
    const stratAgg = new Map<string, { total: number; wins: number; avgR: number; netPnl: number }>();
    const marketAgg = new Map<string, { total: number; wins: number; netPnl: number }>();
    const planDeviation = { complete: 0, partial: 0, none: 0 };
    for (const j of all) {
      if (j.strategyVersion) {
        const g = stratAgg.get(j.strategyVersion) ?? { total: 0, wins: 0, avgR: 0, netPnl: 0 };
        g.total++;
        g.netPnl += j.netPnl ?? 0;
        if ((j.netPnl ?? 0) > 0) g.wins++;
        if (j.rMultiple !== undefined) g.avgR += j.rMultiple;
        stratAgg.set(j.strategyVersion, g);
      }
      const m = marketAgg.get(j.market) ?? { total: 0, wins: 0, netPnl: 0 };
      m.total++;
      m.netPnl += j.netPnl ?? 0;
      if ((j.netPnl ?? 0) > 0) m.wins++;
      marketAgg.set(j.market, m);
      if (j.planExecution === 'complete') planDeviation.complete++;
      else if (j.planExecution === 'partial') planDeviation.partial++;
      else planDeviation.none++;
    }
    const byStrategy: TradeJournalStats['byStrategy'] = {};
    for (const [k, g] of stratAgg) {
      const rCount = all.filter((j) => j.strategyVersion === k && j.rMultiple !== undefined).length;
      byStrategy[k] = { total: g.total, winRate: g.total ? g.wins / g.total : 0, avgR: rCount ? g.avgR / rCount : 0, netPnl: g.netPnl };
    }
    const byMarket: TradeJournalStats['byMarket'] = {};
    for (const [k, m] of marketAgg) {
      byMarket[k] = { total: m.total, winRate: m.total ? m.wins / m.total : 0, netPnl: m.netPnl };
    }
    const disciplines = all.map((j) => j.disciplineScore).filter((s): s is number => s !== undefined && Number.isFinite(s));
    const emotions = all.map((j) => j.emotionScore).filter((s): s is number => s !== undefined && Number.isFinite(s));
    return {
      total: all.length,
      closed: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length ? wins.length / closed.length : 0,
      avgR,
      expectancy: closed.length ? closed.reduce((a, j) => a + (j.netPnl ?? 0), 0) / closed.length : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
      netPnl: closed.reduce((a, j) => a + (j.netPnl ?? 0), 0),
      avgDiscipline: disciplines.length ? disciplines.reduce((a, b) => a + b, 0) / disciplines.length : 0,
      avgEmotion: emotions.length ? emotions.reduce((a, b) => a + b, 0) / emotions.length : 0,
      tagFrequency,
      byStrategy,
      byMarket,
      planDeviation,
    };
  }
}
