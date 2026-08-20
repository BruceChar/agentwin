import { describe, expect, it } from 'vitest';
import { resolveProxyConfig, proxyToBinanceConnector, type ProxyConfig } from '../src/binance/proxy.ts';
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

describe('BinanceRest proxy wiring', () => {
  it('passes dispatcher when proxy enabled, none when off', async () => {
    const captured: RequestInit[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      captured.push(init ?? {});
      const url = String(input);
      if (url.includes('/ping')) return new Response('{}', { status: 200 });
      if (url.includes('/klines')) return new Response('[[1700000000000,"100","110","90","105","10",1700000059999,"1000",50,"5","500"]]', { status: 200 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const withProxy = new BinanceRest({
      fetchImpl,
      proxyConfig: { mode: 'on', url: 'http://127.0.0.1:7890', enabled: true, source: 'explicit' },
      spotBaseUrl: SPOT_DATA_API_BASE,
    });
    await withProxy.klines('SPOT', 'BTCUSDT', '1h', { limit: 1 });
    const proxied = captured.find((i) => (i as Record<string, unknown>)['dispatcher'] !== undefined);
    expect(proxied).toBeTruthy();

    captured.length = 0;
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
