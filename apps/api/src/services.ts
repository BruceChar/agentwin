import { createStorage, type StorageAdapter } from '@agentwin/db';
import { BinanceMarketData, BinanceOfficialMarketData, BinanceRest, MockMarketData, resolveProxyConfig, type MarketDataProvider } from '@agentwin/market';
import { ProxySettings } from './proxy-settings.ts';
import { StorageSettings } from './storage-settings.ts';
import { LlmSettings } from './llm-settings.ts';
import { registerBuiltinStrategies, builtinRegistry } from '@agentwin/strategy';
import { LLMService } from '@agentwin/llm';
import { TradingToolkit } from '@agentwin/llm';
import { SentimentAnalyzer } from '@agentwin/llm';
import { SentimentService } from '@agentwin/sentiment';
import { BinanceAccountSync } from './binance-sync.ts';
import { TradeJournalStore } from './journal-store.ts';
import { JournalAutoFill } from './journal-autofill.ts';
import type { AppConfig } from './config.ts';

export interface AppServices {
  config: AppConfig;
  storage: StorageAdapter;
  marketData: MarketDataProvider;
  /** Binance 私有接口（真实账户同步；仅只读） */
  rest: BinanceRest;
  sync: BinanceAccountSync;
  /** 运行时代理设置（前端可开关） */
  proxySettings: ProxySettings;
  /** 存储路径设置（JSONL 主存储可运行时迁移并持久化） */
  storageSettings: StorageSettings;
  /** LLM 设置（provider / model / apiKey 可运行时修改并持久化） */
  llmSettings: LlmSettings;
  /** 结构化交易日志（JSONL 主存储 + SQLite 镜像） */
  journalStore: TradeJournalStore;
  journalAutoFill: JournalAutoFill;
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
  // 运行时代理设置：所有客户端共享同一 ProxyConfig 对象，前端切换即时生效
  const proxySettings = new ProxySettings(resolveProxyConfig());
  const baseOpts = {
    apiKey: config.binanceApiKey,
    apiSecret: config.binanceApiSecret,
    spotBaseUrl: process.env.BINANCE_SPOT_BASE_URL,
    futuresBaseUrl: process.env.BINANCE_FUTURES_BASE_URL,
    dataApiBaseUrl: process.env.BINANCE_DATA_API_BASE_URL,
    proxyConfig: proxySettings.config,
  };
  const marketData: MarketDataProvider = process.env.AGENTWIN_USE_MOCK === '1'
    ? new MockMarketData()
    : process.env.BINANCE_PROVIDER === 'official'
      ? new BinanceOfficialMarketData(baseOpts)
      : new BinanceMarketData(baseOpts);
  await marketData.init();

  const llmSettings = new LlmSettings(config.llmProvider, config.llmModel);
  const llmCfg = llmSettings.get();
  const llm = new LLMService({ provider: llmCfg.provider, model: llmCfg.model });

  // 模拟（paper/mock）账户：PAPER_ENABLED=0 时关闭，不自动创建
  let paperAccount: Awaited<ReturnType<StorageAdapter['listAccounts']>>[number] | null = null;
  if (config.paperEnabled) {
    const accounts = await storage.listAccounts();
    if (!accounts.some((a) => a.type === 'paper')) {
      await storage.createAccount({ name: 'paper-main', type: 'paper' });
    }
    paperAccount = (await storage.listAccounts()).find((a) => a.type === 'paper') ?? null;
    if (paperAccount) await storage.setBalance(paperAccount.id, 'USDT', config.paperInitialCapital, 0);
  }

  const toolkit = new TradingToolkit({
    storage, marketData, strategyRegistry: builtinRegistry, accountId: paperAccount?.id,
  });
  const sentiment = new SentimentService({
    storage,
    analyzer: new SentimentAnalyzer(llm),
  });

  // Binance 私有接口 + 真实账户同步（key 只对官方主端点有效）
  const rest = new BinanceRest({
    apiKey: config.binanceApiKey,
    apiSecret: config.binanceApiSecret,
    spotBaseUrl: process.env.BINANCE_SPOT_BASE_URL,
    futuresBaseUrl: process.env.BINANCE_FUTURES_BASE_URL,
    proxyConfig: proxySettings.config,
  });
  const sync = new BinanceAccountSync(storage, rest, marketData);

  // 结构化交易日志：JSONL 主存储 + SQLite 镜像（主存储路径可运行时修改并持久化）
  const storageSettings = new StorageSettings(
    process.env.JOURNAL_PATH ?? './data/trade-journal.jsonl',
    config.dbPath,
  );
  const journalStore = new TradeJournalStore(storageSettings.get().journalPath, storage);
  await journalStore.init();
  const journalAutoFill = new JournalAutoFill(marketData);

  const services: AppServices = { config, storage, marketData, rest, sync, proxySettings, storageSettings, llmSettings, journalStore, journalAutoFill, llm, toolkit, sentiment };

  // 配置了 key 且非 Mock 模式：启动后自动同步一次真实账户（不阻塞启动）
  if (process.env.AGENTWIN_USE_MOCK !== '1' && config.binanceApiKey && config.binanceApiSecret) {
    void services.sync.syncAll().then((r) => {
      if (r.ok) console.log('[sync] 真实账户已同步: 余额 ' + r.balancesUpserted + ' 笔, 合约持仓 ' + r.futuresPositions + ' 个, 成交 ' + r.tradesSynced + ' 条');
      else console.warn('[sync] 真实账户同步失败: ' + (r.message ?? 'unknown'));
    }).catch((e) => console.warn('[sync] 真实账户同步异常: ' + (e instanceof Error ? e.message : String(e))));
  }

  return services;
}

export async function closeServices(services: AppServices): Promise<void> {
  await services.storage.close();
  await services.marketData.close();
}
