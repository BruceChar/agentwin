import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** pi-ai provider → 对应 API Key 环境变量（pi-ai 调用时实时读取 env，运行时写入立即生效） */
const PROVIDER_ENV: Record<string, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  moonshotai: 'MOONSHOT_API_KEY',
  'moonshotai-cn': 'MOONSHOT_API_KEY',
  zai: 'ZAI_API_KEY',
  'zai-coding-cn': 'ZAI_CODING_CN_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  xai: 'XAI_API_KEY',
  groq: 'GROQ_API_KEY',
  google: 'GEMINI_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  together: 'TOGETHER_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  'minimax-cn': 'MINIMAX_CN_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  'qwen-token-plan': 'QWEN_TOKEN_PLAN_API_KEY',
  'qwen-token-plan-cn': 'QWEN_TOKEN_PLAN_CN_API_KEY',
  xiaomi: 'XIAOMI_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  huggingface: 'HF_TOKEN',
};

export interface LlmSettingsView {
  provider: string;
  model: string;
  /** 是否已配置 API Key */
  apiKeySet: boolean;
  /** 掩码展示用（sk-***xxxx） */
  apiKeyMask: string | null;
}

/**
 * LLM 设置（provider / model / apiKey）：
 * - 持久化到 data/agentwin-llm.json，重启后继续生效；
 * - apiKey 立即写入对应 provider 的环境变量（pi-ai 调用时实时读取），无需重启；
 * - model 切换通过 llm.configure() 同步给 LLMService。
 */
export class LlmSettings {
  private readonly settingsFile: string;
  private provider: string;
  private model: string;
  private apiKey: string | null = null;

  constructor(envProvider: string, envModel: string, settingsFile?: string) {
    this.settingsFile = settingsFile ?? resolve(process.cwd(), 'data/agentwin-llm.json');
    let persisted: { provider?: string; model?: string; apiKey?: string } = {};
    try {
      persisted = JSON.parse(readFileSync(this.settingsFile, 'utf8')) as typeof persisted;
    } catch {
      /* 尚无设置文件 */
    }
    this.provider = String(persisted.provider ?? envProvider ?? 'deepseek').trim() || 'deepseek';
    this.model = String(persisted.model ?? envModel ?? 'deepseek-v4-flash').trim() || 'deepseek-v4-flash';
    const envKey = PROVIDER_ENV[this.provider];
    this.apiKey = persisted.apiKey ?? (envKey ? process.env[envKey] ?? null : null);
    this.applyEnv();
  }

  get(): LlmSettingsView {
    return {
      provider: this.provider,
      model: this.model,
      apiKeySet: Boolean(this.apiKey),
      apiKeyMask: this.apiKey ? maskKey(this.apiKey) : null,
    };
  }

  /** 应用新配置：立即写环境变量并持久化 */
  apply(patch: { provider?: string; model?: string; apiKey?: string }): void {
    if (patch.provider !== undefined) {
      const p = String(patch.provider).trim();
      if (p) this.provider = p;
    }
    if (patch.model !== undefined) {
      const m = String(patch.model).trim();
      if (m) this.model = m;
    }
    if (patch.apiKey !== undefined) {
      const k = String(patch.apiKey).trim();
      this.apiKey = k || null;
    }
    this.applyEnv();
    mkdirSync(dirname(this.settingsFile), { recursive: true });
    writeFileSync(
      this.settingsFile,
      JSON.stringify({ provider: this.provider, model: this.model, apiKey: this.apiKey ?? undefined }, null, 2) + '\n',
      'utf8',
    );
  }

  /** 把 apiKey 写入当前 provider 的环境变量（pi-ai 调用时实时读取） */
  private applyEnv(): void {
    if (!this.apiKey) return;
    const env = PROVIDER_ENV[this.provider];
    if (env) process.env[env] = this.apiKey;
  }
}

function maskKey(k: string): string {
  if (k.length <= 8) return '***';
  return k.slice(0, 3) + '***' + k.slice(-4);
}
