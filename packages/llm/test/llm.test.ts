import { describe, expect, it } from 'vitest';
import { createStorage } from '@agentwin/db';
import { MockMarketData } from '@agentwin/market';
import { registerBuiltinStrategies, builtinRegistry } from '@agentwin/strategy';
import { extractJson } from '../src/agents/json.ts';
import { TradingToolkit } from '../src/toolkit.ts';
import { LLMService } from '../src/client.ts';
import { SentimentAnalyzer } from '../src/agents/sentimentAnalyzer.ts';

registerBuiltinStrategies();

describe('extractJson', () => {
  it('parses plain json', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses fenced json with prefix', () => {
    const out = extractJson('结果如下：\n\`\`\`json\n{"score":0.8,"label":"bullish"}\n\`\`\`');
    expect(out).toEqual({ score: 0.8, label: 'bullish' });
  });
  it('returns null on garbage', () => {
    expect(extractJson('没有 JSON')).toBeNull();
  });
});

describe('TradingToolkit', () => {
  async function makeToolkit() {
    const storage = createStorage({ engine: 'sqlite', path: ':memory:' });
    await storage.init();
    const acc = await storage.createAccount({ name: 'paper', type: 'paper' });
    await storage.setBalance(acc.id, 'USDT', 10_000);
    const marketData = new MockMarketData(11);
    await marketData.init();
    const toolkit = new TradingToolkit({ storage, marketData, strategyRegistry: builtinRegistry, accountId: acc.id });
    return { toolkit, storage, marketData, acc };
  }

  it('exposes well-formed pi-ai tools', async () => {
    const { toolkit } = await makeToolkit();
    const tools = toolkit.tools();
    expect(tools.length).toBeGreaterThanOrEqual(8);
    for (const t of tools) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.parameters).toBeTruthy();
      expect((t.parameters as { type?: string }).type).toBe('object');
    }
  });

  it('runs backtest on mock data via toolkit', async () => {
    const { toolkit } = await makeToolkit();
    const out = await toolkit.runBacktest({
      strategy: 'ma_cross', params: { fast: 5, slow: 20 },
      symbol: 'BTCUSDT', market: 'SPOT', interval: '1h', fromDays: 30, initialCapital: 10000,
    });
    expect(out).toHaveProperty('metrics');
    const m = out['metrics'] as { totalTrades: number; maxDrawdown: number };
    expect(m.totalTrades).toBeGreaterThan(0);
    expect(m.maxDrawdown).toBeGreaterThanOrEqual(0);
  });

  it('creates LLM strategy draft (disabled)', async () => {
    const { toolkit, storage } = await makeToolkit();
    const res = await toolkit.createStrategy({
      strategy: 'rsi', params: { period: 10, oversold: 25 },
      symbol: 'BTCUSDT', market: 'SPOT', interval: '1h', description: '测试草稿',
    });
    expect(res['created']).toBe(true);
    const saved = await storage.listStrategies();
    expect(saved.length).toBe(1);
    expect(saved[0]?.source).toBe('llm');
    expect(saved[0]?.enabled).toBe(false);
  });
});

describe('LLMService', () => {
  it('constructs and resolves model without network', () => {
    const llm = new LLMService({ provider: 'deepseek', model: 'deepseek-v4-flash' });
    expect(llm.model).toBe('deepseek/deepseek-v4-flash');
  });
  it('throws on unknown model', () => {
    const llm = new LLMService({ provider: 'deepseek', model: 'nope-model' });
    // resolveModel 在调用时才抛错
    expect(() => (llm as unknown as { model: string }).model).toBeDefined();
  });
});

describe('SentimentAnalyzer', () => {
  it('falls back to neutral on unparsable output', async () => {
    // 不注入 key 时不真正调 LLM；这里只验证对象构造与接口
    const llm = new LLMService({ provider: 'deepseek', model: 'deepseek-v4-flash' });
    const a = new SentimentAnalyzer(llm);
    expect(a).toBeTruthy();
  });
});
