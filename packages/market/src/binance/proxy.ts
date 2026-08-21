import { ProxyAgent, fetch as undiciFetch } from 'undici';

export type ProxyMode = 'off' | 'on' | 'auto';

/**
 * 永远直连的主机（公共行情端点，国内网络通常可直连）：
 * 即使 BINANCE_PROXY=on 也强制不走代理——避免公共行情被代理出口的地区限制误伤。
 */
export const DIRECT_ONLY_HOSTS = [
  'data-api.binance.vision',
  'data-stream.binance.vision',
];

/** 判断 URL 是否属于「永远直连」主机 */
export function isDirectHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DIRECT_ONLY_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

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
/** 代理 URL 规范化：缺协议头时自动补 http://（避免用户漏写导致代理不可用） */
export function normalizeProxyUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const t = url.trim();
  if (!t) return undefined;
  if (!/^https?:\/\//i.test(t) && !/^socks5?:\/\//i.test(t)) return 'http://' + t;
  return t;
}

export function resolveProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const mode = (env.BINANCE_PROXY ?? 'auto') as ProxyMode;
  const explicit = normalizeProxyUrl(env.BINANCE_PROXY_URL);
  if (mode === 'off' || explicit === 'off') return { mode: 'off', enabled: false, source: 'off' };
  if (explicit) return { mode: mode === 'on' ? 'on' : 'on', url: explicit, enabled: true, source: 'explicit' };
  const fromEnv = normalizeProxyUrl(env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy);
  if (mode === 'on' || mode === 'auto') {
    return fromEnv
      ? { mode, url: fromEnv, enabled: true, source: 'env' }
      : { mode, enabled: false, source: 'off' };
  }
  return { mode: 'off', enabled: false, source: 'off' };
}

const proxyAgents = new Map<string, ProxyAgent>();

/** 获取代理 dispatcher（未启用或未配置返回 undefined；按 URL 缓存，切换地址时自动重建） */
export function getProxyDispatcher(cfg: ProxyConfig): ProxyAgent | undefined {
  if (!cfg.enabled || !cfg.url) return undefined;
  let agent = proxyAgents.get(cfg.url);
  if (!agent) {
    agent = new ProxyAgent(cfg.url);
    proxyAgents.set(cfg.url, agent);
  }
  return agent;
}

/** 测试/诊断用：清空代理实例缓存 */
export function clearProxyAgents(): void {
  for (const a of proxyAgents.values()) a.close();
  proxyAgents.clear();
}

/**
 * 返回带代理的 fetch 函数（undici 自带 fetch + ProxyAgent，避免与 Node 内置 fetch 的
 * dispatcher 版本不兼容）；代理关闭时返回 undefined（调用方应使用自己的 fetch）。
 * 注意：Node 全局 fetch 不能直接用 npm undici 的 ProxyAgent（报 invalid onRequestStart method）。
 */
export function createProxiedFetch(cfg: ProxyConfig): typeof fetch | undefined {
  if (!cfg.enabled || !cfg.url) return undefined;
  const dispatcher = getProxyDispatcher(cfg);
  if (!dispatcher) return undefined;
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    return undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...init, dispatcher });
  }) as typeof fetch;
}

/** 判断 Binance 响应是否为地理封锁（受限地区） */
export function isGeoRestricted(body: string): boolean {
  return body.includes('Service unavailable from a restricted location')
    || body.includes('restricted location')
    || body.includes('b. Eligibility');
}

/** 地理封锁的友好中文提示 */
export function geoRestrictedHint(): string {
  return '币安拒绝了当前出口 IP（受限地区，通常为美国节点）。请把代理节点切换到非受限地区（如新加坡/日本/香港），或在页面关闭代理后重试。';
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
