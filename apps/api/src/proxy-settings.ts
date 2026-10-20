import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type ProxyConfig, type ProxyMode } from '@agentwin/market';

export interface ProxyPatch {
  mode?: ProxyMode;
  url?: string;
}

/**
 * 运行时代理设置：所有 Binance 客户端（native/official、REST/WS）共享同一个
 * ProxyConfig 对象引用，apply() 修改后即时生效，无需重启。
 * 持久化到 data/agentwin-proxy.json：前端切换的代理/直连在服务重启后保持，
 * 不会被环境变量默认值覆盖。
 */
export class ProxySettings {
  config: ProxyConfig;
  private readonly settingsFile: string;

  constructor(initial: ProxyConfig, settingsFile?: string) {
    const file = settingsFile ?? process.env.AGENTWIN_PROXY_FILE ?? resolve(process.cwd(), 'data/agentwin-proxy.json');
    this.settingsFile = file;
    this.config = { ...initial };
    try {
      const persisted = JSON.parse(readFileSync(file, 'utf8')) as { mode?: ProxyMode; url?: string };
      if (persisted && persisted.mode && ['off', 'on', 'auto'].includes(persisted.mode)) {
        this.config.mode = persisted.mode;
        this.config.url = persisted.url || undefined;
        this.config.enabled = this.config.mode !== 'off' && Boolean(this.config.url);
        this.config.source = this.config.url ? 'explicit' : 'off';
      }
    } catch { /* 无持久化文件：使用初始（环境变量）配置 */ }
  }

  get(): ProxyConfig {
    return this.config;
  }

  apply(patch: ProxyPatch): ProxyConfig {
    if (patch.mode !== undefined) {
      if (!['off', 'on', 'auto'].includes(patch.mode)) throw new Error('mode 必须是 off/on/auto');
      this.config.mode = patch.mode;
    }
    if (patch.url !== undefined) {
      const raw = String(patch.url).trim();
      this.config.url = raw && !/^https?:\/\//i.test(raw) ? 'http://' + raw : (raw || undefined);
    }
    // 运行时切换：直接以配置为准（不自动回读环境变量）
    this.config.enabled = this.config.mode !== 'off' && Boolean(this.config.url);
    this.config.source = this.config.url ? 'explicit' : 'off';
    try {
      mkdirSync(dirname(this.settingsFile), { recursive: true });
      writeFileSync(this.settingsFile, JSON.stringify({ mode: this.config.mode, url: this.config.url ?? null }, null, 2), 'utf8');
    } catch { /* 持久化失败不影响运行时生效 */ }
    return this.config;
  }
}
