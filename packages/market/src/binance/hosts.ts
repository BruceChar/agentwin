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
  ]);
}

/** 探测主机可用性（ping，4s 超时） */
export async function probeBase(base: string, market: Market, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis), dispatcher?: unknown): Promise<boolean> {
  try {
    const path = market === 'SPOT' ? '/api/v3/ping' : '/fapi/v1/ping';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const init: RequestInit = { signal: ctrl.signal };
      if (dispatcher) (init as Record<string, unknown>)['dispatcher'] = dispatcher;
      const res = await fetchImpl(base + path, init);
      return res.ok;
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
