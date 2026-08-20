import { type ProxyConfig, type ProxyMode } from '@agentwin/market';

export interface ProxyPatch {
  mode?: ProxyMode;
  url?: string;
}

/**
 * 运行时代理设置：所有 Binance 客户端（native/official、REST/WS）共享同一个
 * ProxyConfig 对象引用，apply() 修改后即时生效，无需重启。
 */
export class ProxySettings {
  config: ProxyConfig;

  constructor(initial: ProxyConfig) {
    this.config = { ...initial };
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
      const url = String(patch.url).trim();
      this.config.url = url || undefined;
    }
    // 运行时切换：直接以配置为准（不自动回读环境变量）
    this.config.enabled = this.config.mode !== 'off' && Boolean(this.config.url);
    this.config.source = this.config.url ? 'explicit' : 'off';
    return this.config;
  }
}
