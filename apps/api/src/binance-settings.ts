import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface BinanceSettingsView {
  /** 是否已配置 API Key */
  apiKeySet: boolean;
  /** 掩码展示用（前 3 位 *** 后 4 位，绝不返回明文） */
  apiKeyMask: string | null;
  /** 是否已配置 API Secret（仅返回状态，不返回任何值） */
  hasSecret: boolean;
  /** 凭据来源：settings=设置页保存 / env=环境变量（BINANCE_API_KEY/SECRET） */
  source: 'settings' | 'env' | null;
  /** 设置页最近一次保存时间（毫秒时间戳；env 来源时为 null） */
  updatedAt: number | null;
}

/**
 * Binance API 凭据设置：
 * - 持久化到 data/agentwin-binance.json（明文仅存本地文件，API 返回一律掩码）；
 * - 优先读持久化设置，未设置时回退环境变量 BINANCE_API_KEY / BINANCE_API_SECRET；
 * - 保存/清除后由 services 重建 BinanceRest，立即生效无需重启。
 */
export class BinanceSettings {
  private readonly settingsFile: string;
  private readonly envKey: string | null;
  private readonly envSecret: string | null;
  private apiKey: string | null = null;
  private apiSecret: string | null = null;
  private updatedAt: number | null = null;
  private source: 'settings' | 'env' | null = null;

  constructor(envKey?: string, envSecret?: string, settingsFile?: string) {
    this.settingsFile = settingsFile ?? resolve(process.cwd(), 'data/agentwin-binance.json');
    // env 参数缺省时回退 process.env（测试/调用方只设 env 时同样生效）；清除后回退到这份快照
    this.envKey = (envKey ?? process.env.BINANCE_API_KEY) || null;
    this.envSecret = (envSecret ?? process.env.BINANCE_API_SECRET) || null;
    let persisted: { apiKey?: string; apiSecret?: string; updatedAt?: number } = {};
    try {
      persisted = JSON.parse(readFileSync(this.settingsFile, 'utf8')) as typeof persisted;
    } catch {
      /* 尚无设置文件 */
    }
    if (persisted.apiKey || persisted.apiSecret) {
      this.apiKey = persisted.apiKey ?? null;
      this.apiSecret = persisted.apiSecret ?? null;
      this.updatedAt = typeof persisted.updatedAt === 'number' ? persisted.updatedAt : Date.now();
      this.source = 'settings';
    } else if (this.envKey || this.envSecret) {
      this.apiKey = this.envKey;
      this.apiSecret = this.envSecret;
      this.source = 'env';
    }
  }

  get(): BinanceSettingsView {
    return {
      apiKeySet: Boolean(this.apiKey),
      apiKeyMask: this.apiKey ? maskKey(this.apiKey) : null,
      hasSecret: Boolean(this.apiSecret),
      source: this.source,
      updatedAt: this.updatedAt,
    };
  }

  /** 保存新配置：空串或全空 = 清除对应项；两者都空 = 清除全部（删除设置文件，回到环境变量） */
  apply(patch: { apiKey?: string; apiSecret?: string }): BinanceSettingsView {
    if (patch.apiKey !== undefined) {
      const k = String(patch.apiKey).trim();
      this.apiKey = k || null;
    }
    if (patch.apiSecret !== undefined) {
      const s = String(patch.apiSecret).trim();
      this.apiSecret = s || null;
    }
    if (!this.apiKey && !this.apiSecret) {
      // 全部清除：删除设置文件，回退环境变量（构造时快照）
      this.apiKey = this.envKey;
      this.apiSecret = this.envSecret;
      this.updatedAt = null;
      this.source = this.apiKey || this.apiSecret ? 'env' : null;
      try {
        unlinkSync(this.settingsFile);
      } catch {
        /* 文件本就不存在 */
      }
    } else {
      this.updatedAt = Date.now();
      this.source = 'settings';
      mkdirSync(dirname(this.settingsFile), { recursive: true });
      writeFileSync(
        this.settingsFile,
        JSON.stringify(
          { apiKey: this.apiKey ?? undefined, apiSecret: this.apiSecret ?? undefined, updatedAt: this.updatedAt },
          null,
          2,
        ) + '\n',
        'utf8',
      );
    }
    return this.get();
  }

  /** 明文凭据（仅供进程内重建 BinanceRest；不经过任何 API 返回） */
  credentials(): { apiKey: string | null; apiSecret: string | null } {
    return { apiKey: this.apiKey, apiSecret: this.apiSecret };
  }
}

/** 掩码：前 3 位 *** 后 4 位；过短直接 *** */
function maskKey(k: string): string {
  if (k.length <= 8) return '***';
  return k.slice(0, 3) + '***' + k.slice(-4);
}
