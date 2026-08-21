import { describe, expect, it } from 'vitest';
import { clearProxyAgents, createProxiedFetch, getProxyDispatcher, isDirectHost, isGeoRestricted, resolveProxyConfig, proxyToBinanceConnector, type ProxyConfig } from '../src/binance/proxy.ts';
import { BinanceRest } from '../src/binance/rest.ts';
import { SPOT_DATA_API_BASE } from '../src/binance/hosts.ts';

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe('resolveProxyConfig', () => {
  it('default auto: uses HTTPS_PROXY when set, else direct', () => {
    const on: ProxyConfig = resolveProxyConfig(env({ HTTPS_PROXY: 'http://127.0.0.1:7890' }));
    expect(on.enabled).toBe(true);
    expect(on.url).toBe('http://127.0.0.1:7890');
    expect(on.source).toBe('env');
    const off: ProxyConfig = resolveProxyConfig(env({}));
    expect(off.enabled).toBe(false);
    expect(off.source).toBe('off');
  });

  it('off forces direct even with HTTPS_PROXY', () => {
    const c = resolveProxyConfig(env({ BINANCE_PROXY: 'off', HTTPS_PROXY: 'http://127.0.0.1:7890' }));
    expect(c.enabled).toBe(false);
  });

  it('on + explicit URL wins over env', () => {
    const c = resolveProxyConfig(env({ BINANCE_PROXY: 'on', BINANCE_PROXY_URL: 'http://127.0.0.1:8888', HTTPS_PROXY: 'http://127.0.0.1:7890' }));
    expect(c.enabled).toBe(true);
    expect(c.url).toBe('http://127.0.0.1:8888');
    expect(c.source).toBe('explicit');
  });

  it('on without URL falls back to HTTPS_PROXY', () => {
    const c = resolveProxyConfig(env({ BINANCE_PROXY: 'on', HTTPS_PROXY: 'http://127.0.0.1:7890' }));
    expect(c.enabled).toBe(true);
    expect(c.source).toBe('env');
  });

  it('auto-prepends http:// when scheme missing', () => {
    const c = resolveProxyConfig(env({ BINANCE_PROXY: 'on', BINANCE_PROXY_URL: '127.0.0.1:7897' }));
    expect(c.url).toBe('http://127.0.0.1:7897');
    const keep = resolveProxyConfig(env({ BINANCE_PROXY: 'on', BINANCE_PROXY_URL: 'socks5://127.0.0.1:1080' }));
    expect(keep.url).toBe('socks5://127.0.0.1:1080');
  });
});

describe('proxyToBinanceConnector', () => {
  it('parses host/port/protocol/auth from URL', () => {
    const c = proxyToBinanceConnector({ mode: 'on', url: 'http://user:pass@127.0.0.1:7890', enabled: true, source: 'explicit' });
    expect(c?.host).toBe('127.0.0.1');
    expect(c?.port).toBe(7890);
    expect(c?.protocol).toBe('http');
    expect(c?.auth?.username).toBe('user');
    expect(c?.auth?.password).toBe('pass');
  });
  it('returns undefined when disabled', () => {
    expect(proxyToBinanceConnector({ mode: 'off', enabled: false, source: 'off' })).toBeUndefined();
  });
});

describe('proxied fetch & dispatcher', () => {
  it('createProxiedFetch returns undici fetch when enabled, undefined when off', () => {
    const on = createProxiedFetch({ mode: 'on', url: 'http://127.0.0.1:7890', enabled: true, source: 'explicit' });
    expect(typeof on).toBe('function');
    const off = createProxiedFetch({ mode: 'off', enabled: false, source: 'off' });
    expect(off).toBeUndefined();
    clearProxyAgents();
  });

  it('getProxyDispatcher returns a ProxyAgent per URL and clears', () => {
    const cfg: ProxyConfig = { mode: 'on', url: 'http://127.0.0.1:7890', enabled: true, source: 'explicit' };
    const d1 = getProxyDispatcher(cfg);
    const d2 = getProxyDispatcher(cfg);
    expect(d1).toBeDefined();
    expect(d2).toBe(d1); // 缓存同一实例
    clearProxyAgents();
    expect(getProxyDispatcher(cfg)).not.toBe(d1); // 清空后重建
    clearProxyAgents();
  });
});

describe('direct-only hosts bypass proxy', () => {
  it('isDirectHost matches public data hosts', () => {
    expect(isDirectHost('https://data-api.binance.vision/api/v3/ping')).toBe(true);
    expect(isDirectHost('wss://data-stream.binance.vision/ws/btc@kline_1m')).toBe(true);
    expect(isDirectHost('https://api.binance.com/api/v3/ping')).toBe(false);
    expect(isDirectHost('https://fapi.binance.com/fapi/v1/ping')).toBe(false);
  });

  it('with proxy ON, direct hosts still use injected fetchImpl', async () => {
    const captured: RequestInit[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      captured.push(init ?? {});
      const url = String(input);
      if (url.includes('/ping')) return new Response('{}', { status: 200 });
      return new Response('[[1700000000000,"100","110","90","105","10",1700000059999,"1000",50,"5","500"]]', { status: 200 });
    }) as typeof fetch;
    const rest = new BinanceRest({
      fetchImpl,
      proxyConfig: { mode: 'on', url: 'http://127.0.0.1:7897', enabled: true, source: 'explicit' },
      spotBaseUrl: 'https://data-api.binance.vision', // 公共行情主机
    });
    const candles = await rest.klines('SPOT', 'BTCUSDT', '1h', { limit: 1 });
    expect(candles).toHaveLength(1);
    expect(captured.length).toBeGreaterThan(0); // 走了 fetchImpl（直连）而非 undici 代理
  });
});

describe('BinanceRest direct path (proxy off)', () => {
  it('uses injected fetchImpl without dispatcher', async () => {
    const captured: RequestInit[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      captured.push(init ?? {});
      const url = String(input);
      if (url.includes('/ping')) return new Response('{}', { status: 200 });
      if (url.includes('/klines')) return new Response('[[1700000000000,"100","110","90","105","10",1700000059999,"1000",50,"5","500"]]', { status: 200 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const direct = new BinanceRest({
      fetchImpl,
      proxyConfig: { mode: 'off', enabled: false, source: 'off' },
      spotBaseUrl: SPOT_DATA_API_BASE,
    });
    await direct.klines('SPOT', 'BTCUSDT', '1h', { limit: 1 });
    const anyDispatcher = captured.some((i) => (i as Record<string, unknown>)['dispatcher'] !== undefined);
    expect(anyDispatcher).toBe(false);
  });
});

describe('geo-block detection', () => {
  it('isGeoRestricted detects Binance restricted-location body', () => {
    expect(isGeoRestricted('{"code":0,"msg":"Service unavailable from a restricted location according to \'b. Eligibility\'..."}')).toBe(true);
    expect(isGeoRestricted('{"msg":"rate limit"}')).toBe(false);
  });

  it('rest throws friendly Chinese hint on 451', async () => {
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('/ping')) return new Response('{}', { status: 200 });
      return new Response('{"code":0,"msg":"Service unavailable from a restricted location according to \'b. Eligibility\' in https://www.binance.com/en/terms."}', { status: 451 });
    }) as typeof fetch;
    const rest = new BinanceRest({ fetchImpl, proxyConfig: { mode: 'off', enabled: false, source: 'off' }, spotBaseUrl: SPOT_DATA_API_BASE });
    await expect(rest.klines('SPOT', 'BTCUSDT', '1h')).rejects.toThrow(/地理封锁|受限地区/);
  });
});
