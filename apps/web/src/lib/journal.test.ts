import { describe, expect, it } from 'vitest';
import { positionUnit, quoteCurrency, splitSymbol } from './journal.ts';

describe('journal 单位辅助（web）', () => {
  it('splitSymbol 拆分币对', () => {
    expect(splitSymbol('BTCUSDT')).toEqual({ base: 'BTC', quote: 'USDT' });
    expect(splitSymbol('ethusdt')).toEqual({ base: 'ETH', quote: 'USDT' });
    expect(splitSymbol('BTCUSDC')).toEqual({ base: 'BTC', quote: 'USDC' });
    expect(splitSymbol('BTCUSD_PERP')).toEqual({ base: 'BTC', quote: 'USD' });
    expect(splitSymbol('')).toEqual({ base: '', quote: 'USDT' });
    expect(splitSymbol('BTC')).toEqual({ base: 'BTC', quote: 'USDT' });
  });

  it('quoteCurrency 返回计价币', () => {
    expect(quoteCurrency('BTCUSDT')).toBe('USDT');
    expect(quoteCurrency('SOLUSDC')).toBe('USDC');
    expect(quoteCurrency('')).toBe('USDT');
  });

  it('positionUnit：逐仓杠杆用币种，其余用计价币', () => {
    // 逐仓杠杆 → 币种
    expect(positionUnit('BTCUSDT', '逐仓杠杆')).toBe('BTC');
    expect(positionUnit('ETHUSDC', '逐仓杠杆')).toBe('ETH');
    // U本位合约 / 现货 / 币本位合约 / 全仓杠杆 → 计价币
    expect(positionUnit('BTCUSDT', 'U本位合约')).toBe('USDT');
    expect(positionUnit('BTCUSDT', '现货')).toBe('USDT');
    expect(positionUnit('BTCUSDT', '全仓杠杆')).toBe('USDT');
    expect(positionUnit('BTCUSDC', '币本位合约')).toBe('USDC');
    // 未填市场默认计价币
    expect(positionUnit('BTCUSDT')).toBe('USDT');
  });
});
