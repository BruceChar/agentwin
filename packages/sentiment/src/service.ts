import { randomUUID } from 'node:crypto';
import type { SentimentLabel, SentimentRecord, SentimentSource } from '@agentwin/shared';
import type { StorageAdapter } from '@agentwin/db';
import type { SentimentAnalyzer } from '@agentwin/llm';
import { RssCollector, isRelevant, type RssItem } from './collector.ts';
import { heuristicScore, wordSentiment } from './scorer.ts';

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

  /**
   * 聚合某币种近期舆情：返回情绪分布 / 来源占比 / 关键词云 / 热门话题 / 时间序列（趋势图与迷你图数据源）
   */
  async aggregate(symbol: string, hours = 24): Promise<SentimentAggregate> {
    const records = await this.storage.listSentiment({ symbol, from: Date.now() - hours * 3_600_000, limit: 500 });
    const avg = records.length > 0 ? records.reduce((a, r) => a + r.score, 0) / records.length : 0;

    // 情绪分布（按 label）
    const distribution = { bullish: 0, neutral: 0, bearish: 0 };
    // 来源占比（归一化：cointelegraph/coindesk/decrypt/rss → rss 分组）
    const sources: Record<string, number> = {};
    // 关键词云：词频 + 情感
    const kwMap = new Map<string, { count: number; scoreSum: number; hits: number }>();
    let lastAt: number | null = null;
    for (const rec of records) {
      if (rec.label === 'bullish') distribution.bullish++;
      else if (rec.label === 'bearish') distribution.bearish++;
      else distribution.neutral++;
      const g = sourceGroup(rec.source);
      sources[g] = (sources[g] ?? 0) + 1;
      for (const w of rec.keywords ?? []) {
        const k = w.toLowerCase();
        const cur = kwMap.get(k) ?? { count: 0, scoreSum: 0, hits: 0 };
        cur.count++;
        cur.scoreSum += rec.score;
        cur.hits++;
        kwMap.set(k, cur);
      }
      if (lastAt === null || rec.createdAt > lastAt) lastAt = rec.createdAt;
    }
    const keywords = [...kwMap.entries()]
      .map(([word, v]) => ({
        word,
        count: v.count,
        sentiment: wordSentiment(word),
        score: Math.round((v.scoreSum / v.hits) * 100) / 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    // 时间序列：按小时/天分桶（24h→1h、7d→6h、30d→12h），覆盖首尾区间
    const bucketMs = hours <= 48 ? 3_600_000 : (hours <= 240 ? 6 * 3_600_000 : 12 * 3_600_000);
    const series = buildSeries(records, bucketMs);

    return {
      symbol,
      averageScore: Math.round(avg * 100) / 100,
      label: labelFor(avg),
      count: records.length,
      latest: records.slice(0, 50),
      distribution,
      sources,
      keywords,
      topics: buildTopics(records),
      series,
      lastAt,
    };
  }
}

/** 来源归一化：RSS 各站点统一归为 rss 分组 */
function sourceGroup(source: string): string {
  const s = source.toLowerCase();
  if (s === 'rss' || s === 'cointelegraph' || s === 'coindesk' || s === 'decrypt' || s === 'news') return 'rss';
  if (s.includes('twitter') || s === 'social') return 'twitter';
  if (s.includes('reddit')) return 'reddit';
  if (s.includes('chain') || s.includes('onchain') || s.includes('链上')) return 'onchain';
  return s;
}

export interface SentimentAggregate {
  symbol: string;
  averageScore: number;
  label: SentimentLabel;
  count: number;
  latest: SentimentRecord[];
  distribution: { bullish: number; neutral: number; bearish: number };
  sources: Record<string, number>;
  keywords: { word: string; count: number; sentiment: 'positive' | 'negative' | 'neutral'; score: number }[];
  topics: { topic: string; count: number; score: number }[];
  series: { t: number; score: number | null; count: number }[];
  lastAt: number | null;
}

/** 按时间分桶：score 为桶内平均（空桶 null），count 为桶内条数 */
function buildSeries(records: SentimentRecord[], bucketMs: number): SentimentAggregate['series'] {
  if (records.length === 0) return [];
  const buckets = new Map<number, { sum: number; count: number }>();
  let minT = Infinity;
  let maxT = -Infinity;
  for (const rec of records) {
    const t = Math.floor(rec.createdAt / bucketMs) * bucketMs;
    const b = buckets.get(t) ?? { sum: 0, count: 0 };
    b.sum += rec.score;
    b.count++;
    buckets.set(t, b);
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  const out: SentimentAggregate['series'] = [];
  for (let t = minT; t <= maxT; t += bucketMs) {
    const b = buckets.get(t);
    out.push({
      t,
      score: b ? Math.round((b.sum / b.count) * 100) / 100 : null,
      count: b?.count ?? 0,
    });
  }
  return out;
}

/** 热门话题：取出现次数最多的关键词，附带平均情绪分 */
function buildTopics(records: SentimentRecord[]): SentimentAggregate['topics'] {
  const map = new Map<string, { count: number; sum: number }>();
  for (const rec of records) {
    for (const w of rec.keywords ?? []) {
      const k = w.toLowerCase();
      const cur = map.get(k) ?? { count: 0, sum: 0 };
      cur.count++;
      cur.sum += rec.score;
      map.set(k, cur);
    }
  }
  return [...map.entries()]
    .map(([topic, v]) => ({ topic, count: v.count, score: Math.round((v.sum / v.count) * 100) / 100 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
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
