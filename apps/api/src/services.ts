import { createStorage, type StorageAdapter } from '@agentwin/db';
import { BinanceMarketData, BinanceOfficialMarketData, BinanceRest, MockMarketData, resolveProxyConfig, type MarketDataProvider } from '@agentwin/market';
import type { ProxyConfig, ProxyMode } from '@agentwin/market';
import { ProxySettings } from './proxy-settings.ts';
import { StorageSettings } from './storage-settings.ts';
import { LlmSettings } from './llm-settings.ts';
import { BinanceSettings } from './binance-settings.ts';
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
  /** Binance API 凭据设置（可运行时修改并持久化；API 返回仅掩码） */
  binanceSettings: BinanceSettings;
  /** 更新 Binance 凭据：持久化 + 重建 rest，立即生效 */
  applyBinanceCredentials: (patch: { apiKey?: string; apiSecret?: string }) => import('./binance-settings.ts').BinanceSettingsView;
  /** 运行时切换代理：持久化 + 重建 REST/WS 代理链路，立即生效（行情/私有接口同步切换） */
  applyProxyConfig: (patch: { mode?: ProxyMode; url?: string }) => ProxyConfig;
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
  // Binance API 凭据设置：持久化优先，环境变量兜底；保存后重建 rest 立即生效
  const binanceSettings = new BinanceSettings(config.binanceApiKey, config.binanceApiSecret);
  const sync = new BinanceAccountSync(storage, rest, marketData, binanceSettings);

  const applyBinanceCredentials = (patch: { apiKey?: string; apiSecret?: string }) => {
    binanceSettings.apply(patch);
    const cred = binanceSettings.credentials();
    const rest2 = new BinanceRest({
      apiKey: cred.apiKey ?? undefined,
      apiSecret: cred.apiSecret ?? undefined,
      spotBaseUrl: process.env.BINANCE_SPOT_BASE_URL,
      futuresBaseUrl: process.env.BINANCE_FUTURES_BASE_URL,
      proxyConfig: proxySettings.config,
    });
    sync.updateRest(rest2);
    services.rest = rest2;
    return binanceSettings.get();
  };

  // 运行时切换代理：持久化配置 + 重建 REST/WS 代理链路（行情 marketData 与私有 rest 同时更新，立即生效）
  const applyProxyConfig = (patch: { mode?: ProxyMode; url?: string }) => {
    const cfg = proxySettings.apply(patch);
    marketData.updateProxy?.(cfg);
    services.rest.updateProxy(cfg);
    return proxySettings.get();
  };

  // 结构化交易日志：JSONL 主存储 + SQLite 镜像（主存储路径可运行时修改并持久化）
  const storageSettings = new StorageSettings(
    process.env.JOURNAL_PATH ?? './data/trade-journal.jsonl',
    config.dbPath,
  );
  const journalStore = new TradeJournalStore(storageSettings.get().journalPath, storage);
  await journalStore.init();
  const journalAutoFill = new JournalAutoFill(marketData);

  const services: AppServices = { config, storage, marketData, rest, sync, proxySettings, storageSettings, llmSettings, binanceSettings, applyBinanceCredentials, applyProxyConfig, journalStore, journalAutoFill, llm, toolkit, sentiment };

  // 配置了 key（环境变量或设置页持久化）且非 Mock 模式：启动后自动同步一次真实账户（不阻塞启动）
  const startupCred = binanceSettings.credentials();
  if (process.env.AGENTWIN_USE_MOCK !== '1' && startupCred.apiKey && startupCred.apiSecret) {
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
