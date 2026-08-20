import { describe, expect, it } from 'vitest';
import { ProxySettings } from '../src/proxy-settings.ts';

describe('ProxySettings', () => {
  it('starts from env-resolved config and applies runtime patches', () => {
    const ps = new ProxySettings({ mode: 'auto', enabled: false, source: 'off' });
    const applied = ps.apply({ mode: 'on', url: 'http://127.0.0.1:7890' });
    expect(applied.mode).toBe('on');
    expect(applied.enabled).toBe(true);
    expect(applied.url).toBe('http://127.0.0.1:7890');
    // 关闭：直连
    ps.apply({ mode: 'off' });
    expect(ps.get().enabled).toBe(false);
  });

  it('rejects invalid mode', () => {
    const ps = new ProxySettings({ mode: 'off', enabled: false, source: 'off' });
    expect(() => ps.apply({ mode: 'banana' as never })).toThrow(/off\/on\/auto/);
  });
});
