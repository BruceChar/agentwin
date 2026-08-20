export interface AppConfig {
  host: string;
  port: number;
  dbEngine: string;
  dbPath: string;
  llmProvider: string;
  llmModel: string;
  paperInitialCapital: number;
  paperTakerFeeRate: number;
  paperSlippageBps: number;
  binanceApiKey?: string;
  binanceApiSecret?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.API_HOST ?? '127.0.0.1',
    port: Number(env.API_PORT ?? 3000),
    dbEngine: env.DB_ENGINE ?? 'sqlite',
    dbPath: env.DB_PATH ?? './data/agentwin.db',
    llmProvider: env.LLM_PROVIDER ?? 'deepseek',
    llmModel: env.LLM_MODEL ?? 'deepseek-v4-flash',
    paperInitialCapital: Number(env.PAPER_INITIAL_BALANCE_USDT ?? 10_000),
    paperTakerFeeRate: Number(env.PAPER_TAKER_FEE_RATE ?? 0.001),
    paperSlippageBps: Number(env.PAPER_SLIPPAGE_BPS ?? 2),
    binanceApiKey: env.BINANCE_API_KEY,
    binanceApiSecret: env.BINANCE_API_SECRET,
  };
}
