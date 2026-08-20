import { describe, expect, it } from 'vitest';
import { BinanceRest, MarketDataUnavailableError, SPOT_BASE, SPOT_DATA_API_BASE } from '../src/binance/rest.ts';

const KLINE_ROW = [1700000000000, '100', '110', '90', '105', '10', 1700000059999, '1000', 50, '5', '500'];

function fakeFetch(hostStates: { url: string; ok: boolean }[]): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const host = hostStates.find((h) => url.startsWith(h.url));
    if (!host || !host.ok) return new Response(null, { status: 502 });
    if (url.includes('/ping')) return new Response('{}', { status: 200 });
    if (url.includes('/klines')) return new Response(JSON.stringify([KLINE_ROW]), { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
}

describe('BinanceRest host fallback', () => {
  it('falls back to data-api when primary is unreachable', async () => {
    const rest = new BinanceRest({
      fetchImpl: fakeFetch([{ url: SPOT_BASE, ok: false }, { url: SPOT_DATA_API_BASE, ok: true }]),
    });
    const candles = await rest.klines('SPOT', 'BTCUSDT', '1h', { limit: 2 });
    expect(candles).toHaveLength(1);
    expect(candles[0]?.close).toBe(105);
    expect(await rest.activeBase('SPOT')).toBe(SPOT_DATA_API_BASE);
  });

  it('uses primary when reachable', async () => {
    const rest = new BinanceRest({
      fetchImpl: fakeFetch([{ url: SPOT_BASE, ok: true }, { url: SPOT_DATA_API_BASE, ok: true }]),
    });
    expect(await rest.activeBase('SPOT')).toBe(SPOT_BASE);
  });

  it('respects explicit spotBaseUrl override', async () => {
    const custom = 'https://binance.example.proxy';
    const rest = new BinanceRest({
      spotBaseUrl: custom,
      fetchImpl: fakeFetch([{ url: custom, ok: true }]),
    });
    expect(await rest.activeBase('SPOT')).toBe(custom);
  });

  it('throws friendly error when all hosts unreachable', async () => {
    const rest = new BinanceRest({
      fetchImpl: fakeFetch([{ url: SPOT_BASE, ok: false }, { url: SPOT_DATA_API_BASE, ok: false }]),
    });
    await expect(rest.klines('SPOT', 'BTCUSDT', '1h')).rejects.toThrow(MarketDataUnavailableError);
    await expect(rest.klines('SPOT', 'BTCUSDT', '1h')).rejects.toThrow(/行情不可达/);
  });

  it('recovers after a transient failure (cache cleared)', async () => {
    let reachable = false;
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (!reachable) return new Response(null, { status: 502 }); // 所有主机都失败
      if (url.includes('/ping')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify([KLINE_ROW]), { status: 200 });
    }) as typeof fetch;
    const rest = new BinanceRest({ fetchImpl });
    await expect(rest.klines('SPOT', 'BTCUSDT', '1h')).rejects.toThrow(/行情不可达/);
    reachable = true; // 网络恢复
    const candles = await rest.klines('SPOT', 'BTCUSDT', '1h'); // 缓存已清，重探成功
    expect(candles).toHaveLength(1);
  });
});
