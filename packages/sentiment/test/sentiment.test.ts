import { describe, expect, it } from 'vitest';
import { createStorage } from '@agentwin/db';
import { parseRss, isRelevant } from '../src/collector.ts';
import { heuristicScore } from '../src/scorer.ts';
import { SentimentService } from '../src/service.ts';

const SAMPLE_XML = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>Bitcoin surges to new all-time high as ETF inflows grow</title>
    <link>https://example.com/1</link>
    <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    <description>Bitcoin ETF approval drives institutional demand. BTC price rally continues.</description>
  </item>
  <item>
    <title>Ethereum network upgrade delayed after security audit</title>
    <link>https://example.com/2</link>
    <pubDate>Mon, 01 Jan 2024 13:00:00 GMT</pubDate>
    <description>ETH developers found a vulnerability, postponing the upgrade.</description>
  </item>
  <item>
    <title>Global markets mixed on Fed comments</title>
    <link>https://example.com/3</link>
  </item>
</channel></rss>`;

describe('parseRss', () => {
  it('parses items and decodes entities', () => {
    const items = parseRss(SAMPLE_XML, 'test');
    expect(items).toHaveLength(3);
    expect(items[0]?.title).toBe('Bitcoin surges to new all-time high as ETF inflows grow');
    expect(items[0]?.pubDate).toBeDefined();
  });
});

describe('isRelevant', () => {
  it('matches symbol keywords in title/body', () => {
    expect(isRelevant('BTC', { title: 'Bitcoin price update' })).toBe(true);
    expect(isRelevant('BTC', { title: 'Ethereum only' })).toBe(false);
    expect(isRelevant('ETH', { title: 'ETH developers' })).toBe(true);
  });
});

describe('heuristicScore', () => {
  it('scores bullish and bearish text', () => {
    const bull = heuristicScore('Bitcoin surges to record high on ETF approval');
    expect(bull.score).toBeGreaterThan(0);
    expect(bull.label).toBe('bullish');
    const bear = heuristicScore('Ethereum crashes after hack and exploit');
    expect(bear.score).toBeLessThan(0);
    expect(bear.label).toBe('bearish');
  });
});

describe('SentimentService', () => {
  it('scans via injected collector and aggregates', async () => {
    const storage = createStorage({ engine: 'sqlite', path: ':memory:' });
    await storage.init();
    const collector = {
      fetchAll: async () => parseRss(SAMPLE_XML, 'test'),
    } as unknown as ConstructorParameters<typeof SentimentService>[0]['collector'];
    const svc = new SentimentService({ storage, collector });
    const res = await svc.scan('BTC');
    expect(res.scanned).toBe(3);
    expect(res.relevant).toBe(1);
    expect(res.stored).toBe(1);
    expect(res.averageScore).toBeGreaterThan(0);
    const agg = await svc.aggregate('BTC');
    expect(agg.count).toBe(1);
    expect(agg.label).toBe('bullish');
    await storage.close();
  });
});
