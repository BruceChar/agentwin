import { ProxyAgent } from 'undici';

export type ProxyMode = 'off' | 'on' | 'auto';

export interface ProxyConfig {
  mode: ProxyMode;
  /** 实际使用的代理地址（来自 BINANCE_PROXY_URL 或 HTTPS_PROXY） */
  url?: string;
  enabled: boolean;
  /** 配置来源：explicit（BINANCE_PROXY_URL）/ env（HTTPS_PROXY）/ off */
  source: 'explicit' | 'env' | 'off';
}

/**
 * 代理配置解析：
 * - BINANCE_PROXY=off   → 强制直连（忽略系统 HTTPS_PROXY；代理出口在受限地区时用这个）
 * - BINANCE_PROXY=on    → 走代理：BINANCE_PROXY_URL 优先，否则 HTTPS_PROXY/HTTP_PROXY
 * - BINANCE_PROXY=auto（默认）→ HTTPS_PROXY 存在则走，否则直连
 * - BINANCE_PROXY_URL   → 显式代理地址（如 http://127.0.0.1:7890）
 */
export function resolveProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const mode = (env.BINANCE_PROXY ?? 'auto') as ProxyMode;
  const explicit = env.BINANCE_PROXY_URL?.trim();
  if (mode === 'off' || explicit === 'off') return { mode: 'off', enabled: false, source: 'off' };
  if (explicit) return { mode: mode === 'on' ? 'on' : 'on', url: explicit, enabled: true, source: 'explicit' };
  const fromEnv = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (mode === 'on' || mode === 'auto') {
    return fromEnv
      ? { mode, url: fromEnv, enabled: true, source: 'env' }
      : { mode, enabled: false, source: 'off' };
  }
  return { mode: 'off', enabled: false, source: 'off' };
}

let sharedProxyAgent: ProxyAgent | null = null;

/** 获取代理 dispatcher（未启用或未配置返回 undefined） */
export function getProxyDispatcher(cfg: ProxyConfig): ProxyAgent | undefined {
  if (!cfg.enabled || !cfg.url) return undefined;
  if (!sharedProxyAgent) sharedProxyAgent = new ProxyAgent(cfg.url);
  return sharedProxyAgent;
}

/** 解析代理 URL 为 @binance/common 期望的 proxy 配置（host/port/protocol/auth） */
export function proxyToBinanceConnector(cfg: ProxyConfig): { host: string; port: number; protocol?: string; auth?: { username: string; password: string } } | undefined {
  if (!cfg.enabled || !cfg.url) return undefined;
  try {
    const u = new URL(cfg.url);
    const auth = u.username || u.password ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } : undefined;
    return { host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)), protocol: u.protocol.replace(':', ''), auth };
  } catch {
    return undefined;
  }
}
