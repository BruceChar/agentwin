import { createStorage, type StorageAdapter } from '@agentwin/db';
import { BinanceMarketData, MockMarketData, type MarketDataProvider } from '@agentwin/market';
import { registerBuiltinStrategies, builtinRegistry } from '@agentwin/strategy';
import { LLMService } from '@agentwin/llm';
import { TradingToolkit } from '@agentwin/llm';
import { SentimentAnalyzer } from '@agentwin/llm';
import { SentimentService } from '@agentwin/sentiment';
import type { AppConfig } from './config.ts';

export interface AppServices {
  config: AppConfig;
  storage: StorageAdapter;
  marketData: MarketDataProvider;
  llm: LLMService;
  toolkit: TradingToolkit;
  sentiment: SentimentService;
}

/** 组装全部服务（存储 / 行情 / LLM / 工具箱 / 舆情） */
export async function createServices(config: AppConfig): Promise<AppServices> {
  registerBuiltinStrategies();
  const storage = createStorage({ engine: config.dbEngine as 'sqlite', path: config.dbPath });
  await storage.init();

  // 行情源：Binance 真实数据；环境变量 AGENTWIN_USE_MOCK=1 时使用 Mock（离线开发）
  const marketData: MarketDataProvider = process.env.AGENTWIN_USE_MOCK === '1'
    ? new MockMarketData()
    : new BinanceMarketData({ apiKey: config.binanceApiKey, apiSecret: config.binanceApiSecret });
  await marketData.init();

  const llm = new LLMService({ provider: config.llmProvider, model: config.llmModel });

  // 默认 paper 账户
  const accounts = await storage.listAccounts();
  if (!accounts.some((a) => a.type === 'paper')) {
    await storage.createAccount({ name: 'paper-main', type: 'paper' });
  }
  const paperAccount = (await storage.listAccounts()).find((a) => a.type === 'paper')!;
  await storage.setBalance(paperAccount.id, 'USDT', config.paperInitialCapital, 0);

  const toolkit = new TradingToolkit({
    storage, marketData, strategyRegistry: builtinRegistry, accountId: paperAccount.id,
  });
  const sentiment = new SentimentService({
    storage,
    analyzer: new SentimentAnalyzer(llm),
  });

  return { config, storage, marketData, llm, toolkit, sentiment };
}

export async function closeServices(services: AppServices): Promise<void> {
  await services.storage.close();
  await services.marketData.close();
}
