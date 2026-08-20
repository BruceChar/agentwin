import { describe, expect, it } from 'vitest';
import { INTERVAL_MS } from '@agentwin/shared';
import { MockMarketData } from '../src/mock.ts';
import { buildQueryString, buildSignedQuery, hmacSha256 } from '../src/binance/sign.ts';
import { parseKlineRow } from '../src/binance/rest.ts';

const T0 = 1_700_000_000_000;

describe('MockMarketData', () => {
  it('generates deterministic klines for the same query', async () => {
    const m = new MockMarketData(7);
    await m.init();
    const q = { symbol: 'BTCUSDT', market: 'SPOT' as const, interval: '1h' as const, startTime: T0, endTime: T0 + 10 * INTERVAL_MS['1h'] };
    const a = await m.getKlines(q);
    const b = await m.getKlines(q);
    expect(a).toHaveLength(10);
    expect(a).toEqual(b);
    expect(a[0]!.high).toBeGreaterThanOrEqual(a[0]!.low);
    expect(a[1]!.openTime - a[0]!.openTime).toBe(INTERVAL_MS['1h']);
    await m.close();
  });

  it('supports symbols and tickers', async () => {
    const m = new MockMarketData();
    const syms = await m.getSymbols('SPOT');
    expect(syms.length).toBeGreaterThan(0);
    const t = await m.getTicker('BTCUSDT', 'SPOT');
    expect(t.lastPrice).toBeGreaterThan(0);
    await m.close();
  });
});

describe('signing helpers', () => {
  it('query string skips undefined', () => {
    expect(buildQueryString({ a: 1, b: undefined, c: 'x y' })).toBe('a=1&c=x%20y');
  });
  it('signed query includes timestamp and signature', () => {
    const qs = buildSignedQuery({ symbol: 'BTCUSDT' }, 'sec', 1234567890);
    expect(qs).toContain('timestamp=1234567890');
    expect(qs).toContain('signature=');
  });
  it('hmac is deterministic', () => {
    expect(hmacSha256('secret', 'msg')).toBe(hmacSha256('secret', 'msg'));
    expect(hmacSha256('secret', 'msg')).not.toBe(hmacSha256('secret', 'msg2'));
  });
});

describe('parseKlineRow', () => {
  it('maps raw binance row', () => {
    const c = parseKlineRow([1700000000000, '100', '110', '90', '105', '10', 1700000059999, '1000', 50, '5', '500']);
    expect(c.open).toBe(100);
    expect(c.close).toBe(105);
    expect(c.trades).toBe(50);
  });
});
