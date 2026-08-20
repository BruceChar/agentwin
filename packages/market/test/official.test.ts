import { describe, expect, it } from 'vitest';
import { BinanceOfficialMarketData } from '../src/officialProvider.ts';
import { SPOT_BASE, SPOT_DATA_API_BASE } from '../src/binance/hosts.ts';

function fakeFetch(hostStates: { url: string; ok: boolean }[]): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const host = hostStates.find((h) => url.startsWith(h.url));
    return host && host.ok ? new Response('{}', { status: 200 }) : new Response(null, { status: 502 });
  }) as typeof fetch;
}

describe('BinanceOfficialMarketData', () => {
  it('probes reachable host for ping (no SDK network call)', async () => {
    const p = new BinanceOfficialMarketData({
      fetchImpl: fakeFetch([{ url: SPOT_BASE, ok: false }, { url: SPOT_DATA_API_BASE, ok: true }]),
    });
    const res = await p.ping();
    expect(res.ok).toBe(true);
    expect(res.host).toBe(SPOT_DATA_API_BASE);
    await p.close();
  });

  it('reports unreachable when all hosts fail', async () => {
    const p = new BinanceOfficialMarketData({
      fetchImpl: fakeFetch([{ url: SPOT_BASE, ok: false }, { url: SPOT_DATA_API_BASE, ok: false }]),
    });
    const res = await p.ping();
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('行情不可达');
    await p.close();
  });
});
