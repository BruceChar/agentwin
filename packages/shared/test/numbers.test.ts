import { describe, expect, it } from 'vitest';
import { realizedPnlFutures, realizedPnlSpot, roundToStep, sanitizeQty } from '../src/numbers.ts';

describe('roundToStep', () => {
  it('rounds to step multiples', () => {
    expect(roundToStep(0.123456, 0.001)).toBe(0.123);
    expect(roundToStep(1.2345, 0.01)).toBe(1.23);
  });
});

describe('sanitizeQty', () => {
  it('enforces min qty', () => {
    expect(sanitizeQty(0.0001, 0.001, 0.001)).toBe(0);
    expect(sanitizeQty(0.0054, 0.001, 0.001)).toBe(0.005);
    expect(sanitizeQty(0.0055, 0.001, 0.001)).toBe(0.006);
  });
});

describe('realized pnl', () => {
  it('spot: buy low sell high minus fees', () => {
    const pnl = realizedPnlSpot(100, 110, 1, 0.1, 0.11);
    expect(pnl).toBeCloseTo(9.79, 5);
  });
  it('futures long', () => {
    expect(realizedPnlFutures('LONG', 100, 120, 1, 0.2)).toBeCloseTo(19.8, 5);
  });
  it('futures short', () => {
    expect(realizedPnlFutures('SHORT', 120, 100, 1, 0.2)).toBeCloseTo(19.8, 5);
  });
});
