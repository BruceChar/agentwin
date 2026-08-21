import type { Market } from '@agentwin/shared';

// ================= 官方端点常量 =================
export const SPOT_BASE = 'https://api.binance.com';
export const SPOT_TESTNET_BASE = 'https://testnet.binance.vision';
export const SPOT_DATA_API_BASE = 'https://data-api.binance.vision';
export const FUTURES_BASE = 'https://fapi.binance.com';

export interface HostOptions {
  spotBaseUrl?: string;
  futuresBaseUrl?: string;
  dataApiBaseUrl?: string;
  testnet?: boolean;
}

/** 市场数据不可达（所有候选主机均失败） */
export class MarketDataUnavailableError extends Error {
  constructor(market: Market, detail: string) {
    super('Binance ' + market + ' 行情不可达：' + detail + ' — 请检查网络，或设置 BINANCE_*_BASE_URL / 使用 AGENTWIN_USE_MOCK=1');
    this.name = 'MarketDataUnavailableError';
  }
}

export function dedupe(list: (string | undefined)[]): string[] {
  return [...new Set(list.filter((s): s is string => Boolean(s)))];
}

/** REST 候选主机：显式配置优先，随后官方主端点 + 备用公共行情端点 */
export function restCandidatesFor(market: Market, opts: HostOptions = {}): string[] {
  if (market === 'SPOT') {
    return dedupe([
      opts.spotBaseUrl,
      process.env.BINANCE_SPOT_BASE_URL,
      opts.testnet ? SPOT_TESTNET_BASE : SPOT_BASE,
      opts.dataApiBaseUrl,
      process.env.BINANCE_DATA_API_BASE_URL,
      SPOT_DATA_API_BASE,
    ]);
  }
  return dedupe([
    opts.futuresBaseUrl,
    process.env.BINANCE_FUTURES_BASE_URL,
    FUTURES_BASE,
    ...FUTURES_ALT_CANDIDATES,
  ]);
}

/** 探测主机可用性（ping，4s 超时；要求 200 且响应为合法 JSON——202/空响应视为不可用） */
export async function probeBase(base: string, market: Market, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis), dispatcher?: unknown): Promise<boolean> {
  try {
    const path = market === 'SPOT' ? '/api/v3/ping' : '/fapi/v1/ping';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const init: RequestInit = { signal: ctrl.signal };
      if (dispatcher) (init as Record<string, unknown>)['dispatcher'] = dispatcher;
      const res = await fetchImpl(base + path, init);
      if (res.status !== 200) return false;
      const text = await res.text();
      if (!text.trim()) return false;
      JSON.parse(text); // ping 返回 {}，202/空/非 JSON 均视为不可用
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** 依次探测候选主机，返回第一个可用者；全部失败抛 MarketDataUnavailableError */
export async function pickReachableBase(market: Market, opts: HostOptions = {}, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis), dispatcher?: unknown): Promise<string> {
  let lastError = 'all hosts unreachable';
  for (const url of restCandidatesFor(market, opts)) {
    if (await probeBase(url, market, fetchImpl, dispatcher)) return url;
    lastError = 'failed: ' + url;
  }
  throw new MarketDataUnavailableError(market, lastError);
}

// 合约备用主机（官方国内直连域名，公开行情与签名请求都可用）
export const FUTURES_ALT_CANDIDATES = [
  'https://fapi1.binance.com',
  'https://fapi2.binance.com',
  'https://fapi3.binance.com',
];

// 签名请求专用备用主机（币安官方国内直连域名；API Key 在这些域名同样有效）
export const SIGNED_SPOT_CANDIDATES = [
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com',
];

/** 签名请求候选：显式配置的主端点优先，随后官方主域名 + api1-4 备用 */
export function signedCandidatesFor(market: Market, opts: HostOptions = {}): string[] {
  if (market === 'SPOT') {
    return dedupe([
      opts.spotBaseUrl,
      process.env.BINANCE_SPOT_BASE_URL,
      opts.testnet ? SPOT_TESTNET_BASE : SPOT_BASE,
      ...SIGNED_SPOT_CANDIDATES,
    ]);
  }
  return dedupe([
    opts.futuresBaseUrl,
    process.env.BINANCE_FUTURES_BASE_URL,
    FUTURES_BASE,
    ...FUTURES_ALT_CANDIDATES,
  ]);
}

/** 选择签名请求可用主机（api.binance.com 被 DNS 污染时自动尝试 api1-4） */
export async function pickSignedBase(market: Market, opts: HostOptions = {}, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis), dispatcher?: unknown): Promise<string> {
  let lastError = 'all signed hosts unreachable';
  for (const url of signedCandidatesFor(market, opts)) {
    if (await probeBase(url, market, fetchImpl, dispatcher)) return url;
    lastError = 'failed: ' + url;
  }
  throw new MarketDataUnavailableError(market, lastError);
}
