// ================= RSS 舆情采集 =================

export interface RssSource {
  name: string;
  url: string;
}

export interface RssItem {
  source: string;
  title: string;
  link?: string;
  description?: string;
  pubDate?: number;
}

export const DEFAULT_RSS_SOURCES: RssSource[] = [
  { name: 'cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'decrypt', url: 'https://decrypt.co/feed' },
];

/** 简易 RSS 解析器（正则，无第三方依赖） */
export function parseRss(xml: string, sourceName: string): RssItem[] {
  const out: RssItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1]!;
    const title = extractTag(block, 'title');
    if (!title) continue;
    out.push({
      source: sourceName,
      title: decodeEntities(stripHtml(title)),
      link: extractTag(block, 'link'),
      description: decodeEntities(stripHtml(extractTag(block, 'description') ?? '')).slice(0, 500),
      pubDate: parsePubDate(extractTag(block, 'pubDate')),
    });
  }
  return out;
}

function extractTag(block: string, tag: string): string | undefined {
  const open = '<' + tag + '>';
  const close = '</' + tag + '>';
  const start = block.indexOf(open);
  if (start < 0) return undefined;
  const contentStart = start + open.length;
  const end = block.indexOf(close, contentStart);
  if (end < 0) return undefined;
  let raw = block.slice(contentStart, end);
  if (raw.startsWith('<![CDATA[')) raw = raw.slice('<![CDATA['.length);
  if (raw.endsWith(']]>')) raw = raw.slice(0, -3);
  return raw.trim();
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function parsePubDate(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
}

/** 币种关键词表（用于相关性过滤与启发式打分） */
export const SYMBOL_KEYWORDS: Record<string, string[]> = {
  BTC: ['bitcoin', ' btc ', 'btc'],
  ETH: ['ethereum', ' eth ', 'eth'],
  SOL: ['solana', ' sol ', 'sol'],
  BNB: ['binance coin', 'bnb'],
  XRP: ['ripple', 'xrp'],
  DOGE: ['dogecoin', 'doge'],
  ADA: ['cardano', 'ada'],
};

/** 判断标题/正文是否与某币种相关（symbol 支持 BTCUSDT / BTC-USDT / BTC 三种写法） */
export function isRelevant(symbol: string, item: { title: string; description?: string }): boolean {
  const base = symbol
    .toUpperCase()
    .replace(/-(USDT|USDC|BUSD|FDUSD|TUSD|DAI|BTC|ETH)$/, '')
    .replace(/(USDT|USDC|BUSD|FDUSD|TUSD|DAI)$/, '');
  const keys = SYMBOL_KEYWORDS[base] ?? [base.toLowerCase()];
  const text = (item.title + ' ' + (item.description ?? '')).toLowerCase();
  return keys.some((k) => text.includes(k.trim().toLowerCase()));
}

/** 采集器：拉取 RSS 源并解析 */
export class RssCollector {
  private readonly sources: RssSource[];
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { sources?: RssSource[]; fetchImpl?: typeof fetch } = {}) {
    this.sources = opts.sources ?? DEFAULT_RSS_SOURCES;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async fetchAll(): Promise<RssItem[]> {
    const results = await Promise.allSettled(this.sources.map((s) => this.fetchSource(s)));
    const out: RssItem[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') out.push(...r.value);
    }
    return out;
  }

  async fetchSource(src: RssSource): Promise<RssItem[]> {
    const res = await this.fetchImpl(src.url, { headers: { 'user-agent': 'AgentWin/0.1' } });
    if (!res.ok) throw new Error('rss fetch failed ' + src.url + ': ' + res.status);
    const xml = await res.text();
    return parseRss(xml, src.name);
  }
}
