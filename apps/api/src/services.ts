import { createStorage, type StorageAdapter } from '@agentwin/db';
import { BinanceMarketData, BinanceOfficialMarketData, MockMarketData, type MarketDataProvider } from '@agentwin/market';
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

  // 行情源选择：
  //   AGENTWIN_USE_MOCK=1        → Mock（离线开发）
  //   BINANCE_PROVIDER=official  → 官方自动生成连接器（@binance/spot 等，basePath 多主机回退）
  //   默认 native                → 自研轻量客户端（多主机自动回退，已实测国内网络可用）
  const baseOpts = {
    apiKey: config.binanceApiKey,
    apiSecret: config.binanceApiSecret,
    spotBaseUrl: process.env.BINANCE_SPOT_BASE_URL,
    futuresBaseUrl: process.env.BINANCE_FUTURES_BASE_URL,
    dataApiBaseUrl: process.env.BINANCE_DATA_API_BASE_URL,
  };
  const marketData: MarketDataProvider = process.env.AGENTWIN_USE_MOCK === '1'
    ? new MockMarketData()
    : process.env.BINANCE_PROVIDER === 'official'
      ? new BinanceOfficialMarketData(baseOpts)
      : new BinanceMarketData(baseOpts);
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
