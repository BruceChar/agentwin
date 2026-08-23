import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageSettings } from '../src/storage-settings.ts';

describe('StorageSettings', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'aw-settings-'));
  const settingsFile = join(tmp, 'agentwin-settings.json');

  it('resolves relative defaults to absolute paths', () => {
    const s = new StorageSettings('./data/trade-journal.jsonl', './data/agentwin.db', settingsFile);
    const p = s.get();
    expect(p.journalPath.endsWith('/data/trade-journal.jsonl')).toBe(true);
    expect(p.dbPath.endsWith('/data/agentwin.db')).toBe(true);
    expect(p.dataDir.endsWith('/data')).toBe(true);
  });

  it('prefers persisted journal path over env default', () => {
    writeFileSync(settingsFile, JSON.stringify({ journalPath: '/persisted/trades.jsonl' }));
    const s = new StorageSettings('./data/trade-journal.jsonl', './data/agentwin.db', settingsFile);
    expect(s.get().journalPath).toBe('/persisted/trades.jsonl');
  });

  it('normalizes directory input by appending trade-journal.jsonl', () => {
    const s = new StorageSettings('./data/trade-journal.jsonl', './data/agentwin.db', settingsFile);
    expect(s.normalize('/tmp/foo/')).toBe('/tmp/foo/trade-journal.jsonl');
    expect(s.normalize('/tmp/foo')).toBe('/tmp/foo/trade-journal.jsonl');
    expect(s.normalize('/tmp/foo.jsonl')).toBe('/tmp/foo.jsonl');
  });

  it('rejects empty path', () => {
    const s = new StorageSettings('./data/trade-journal.jsonl', './data/agentwin.db', settingsFile);
    expect(() => s.normalize('   ')).toThrow(/不能为空/);
  });

  it('save() writes settings file and switches journal path', () => {
    const s = new StorageSettings('./data/trade-journal.jsonl', './data/agentwin.db', settingsFile);
    const p = s.save('/tmp/aw-saved-dir');
    expect(p.journalPath).toBe('/tmp/aw-saved-dir/trade-journal.jsonl');
    expect(p.dataDir).toBe('/tmp/aw-saved-dir');
    expect(JSON.parse(readFileSync(settingsFile, 'utf8')).journalPath).toBe('/tmp/aw-saved-dir/trade-journal.jsonl');
    // 重新构造应读回持久化路径
    const s2 = new StorageSettings('./data/trade-journal.jsonl', './data/agentwin.db', settingsFile);
    expect(s2.get().journalPath).toBe('/tmp/aw-saved-dir/trade-journal.jsonl');
  });

  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});
