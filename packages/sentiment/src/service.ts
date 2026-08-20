import { randomUUID } from 'node:crypto';
import type { SentimentLabel, SentimentRecord, SentimentSource } from '@agentwin/shared';
import type { StorageAdapter } from '@agentwin/db';
import type { SentimentAnalyzer } from '@agentwin/llm';
import { RssCollector, isRelevant, type RssItem } from './collector.ts';
import { heuristicScore } from './scorer.ts';

export interface SentimentServiceDeps {
  storage: StorageAdapter;
  /** 可选：配置后使用 LLM 打分 */
  analyzer?: SentimentAnalyzer;
  collector?: RssCollector;
}

export interface ScanResult {
  scanned: number;
  relevant: number;
  stored: number;
  averageScore: number;
  label: SentimentLabel;
  records: SentimentRecord[];
}

/** 舆情服务：采集 → 相关性过滤 → 打分（LLM 或启发式）→ 落库 → 聚合 */
export class SentimentService {
  private readonly storage: StorageAdapter;
  private readonly analyzer?: SentimentAnalyzer;
  private readonly collector: RssCollector;

  constructor(deps: SentimentServiceDeps) {
    this.storage = deps.storage;
    this.analyzer = deps.analyzer;
    this.collector = deps.collector ?? new RssCollector();
  }

  /** 扫描 RSS 源中与某币种相关的新闻并打分入库 */
  async scan(symbol: string, opts: { useLLM?: boolean } = {}): Promise<ScanResult> {
    const items = await this.collector.fetchAll();
    const relevant = items.filter((i) => isRelevant(symbol, i));
    const stored: SentimentRecord[] = [];
    for (const item of relevant) {
      const rec = await this.scoreAndStore(symbol, item, opts.useLLM ?? !!this.analyzer);
      if (rec) stored.push(rec);
    }
    const avg = stored.length > 0 ? stored.reduce((a, r) => a + r.score, 0) / stored.length : 0;
    return {
      scanned: items.length, relevant: relevant.length, stored: stored.length,
      averageScore: Math.round(avg * 100) / 100,
      label: labelFor(avg),
      records: stored,
    };
  }

  /** 手动提交一条文本（API 输入） */
  async scanManual(symbol: string, headline: string, body: string | undefined, useLLM = true): Promise<SentimentRecord> {
    const item: RssItem = { source: 'manual', title: headline, description: body };
    const rec = await this.scoreAndStore(symbol, item, useLLM && !!this.analyzer);
    if (!rec) throw new Error('failed to score sentiment');
    return rec;
  }

  private async scoreAndStore(symbol: string, item: RssItem, useLLM: boolean): Promise<SentimentRecord | null> {
    let score: number;
    let label: SentimentLabel;
    let keywords: string[];
    let model: string | undefined;
    if (useLLM && this.analyzer) {
      const r = await this.analyzer.score({ symbol, headline: item.title, body: item.description, source: item.source });
      score = r.score; label = r.label; keywords = r.keywords; model = 'llm';
    } else {
      const h = heuristicScore(item.title, item.description);
      score = h.score; label = h.label; keywords = h.keywords; model = 'heuristic';
    }
    const id = 'sen-' + hashString(item.source + '|' + item.title + '|' + symbol);
    const rec: SentimentRecord = {
      id,
      source: item.source as SentimentSource,
      symbol,
      headline: item.title,
      body: item.description,
      url: item.link,
      publishedAt: item.pubDate,
      score, label, keywords, model,
      createdAt: Date.now(),
    };
    await this.storage.upsertSentiment(rec);
    return rec;
  }

  /** 聚合某币种近期舆情 */
  async aggregate(symbol: string, hours = 24): Promise<{ symbol: string; averageScore: number; label: SentimentLabel; count: number; latest: SentimentRecord[] }> {
    const records = await this.storage.listSentiment({ symbol, from: Date.now() - hours * 3_600_000, limit: 100 });
    const avg = records.length > 0 ? records.reduce((a, r) => a + r.score, 0) / records.length : 0;
    return { symbol, averageScore: Math.round(avg * 100) / 100, label: labelFor(avg), count: records.length, latest: records.slice(0, 10) };
  }
}

function labelFor(score: number): SentimentLabel {
  return score > 0.15 ? 'bullish' : (score < -0.15 ? 'bearish' : 'neutral');
}

function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export { randomUUID };
