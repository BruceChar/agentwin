import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export interface StoragePaths {
  /** 主存储数据目录（交易日志所在目录，绝对路径） */
  dataDir: string;
  /** JSONL 主存储文件（绝对路径，可修改） */
  journalPath: string;
  /** SQLite 辅助查询库（绝对路径，跟随 DB_PATH，只读展示） */
  dbPath: string;
}

/**
 * 存储路径设置：
 * - JSONL 主存储路径可运行时修改，持久化到 <dataDir>/agentwin-settings.json，重启后继续生效；
 * - SQLite 辅助库路径固定（跟随 DB_PATH 环境变量），不做运行时迁移。
 */
export class StorageSettings {
  private readonly settingsFile: string;
  private readonly dbPath: string;
  private journalPath: string;

  constructor(envJournalPath: string, envDbPath: string, settingsFile?: string) {
    const cwd = process.cwd();
    this.dbPath = isAbsolute(envDbPath) ? envDbPath : resolve(cwd, envDbPath);
    this.settingsFile = settingsFile ?? resolve(cwd, 'data/agentwin-settings.json');
    // 持久化的路径设置优先于环境变量（JOURNAL_PATH）
    let persisted: string | undefined;
    try {
      const j = JSON.parse(readFileSync(this.settingsFile, 'utf8')) as { journalPath?: string };
      persisted = typeof j.journalPath === 'string' ? j.journalPath : undefined;
    } catch {
      /* 尚无设置文件 */
    }
    const raw = persisted ?? envJournalPath;
    this.journalPath = isAbsolute(raw) ? raw : resolve(cwd, raw);
  }

  get(): StoragePaths {
    return {
      dataDir: dirname(this.journalPath),
      journalPath: this.journalPath,
      dbPath: this.dbPath,
    };
  }

  /**
   * 规范化用户输入：
   * - 目录（不以 .jsonl 结尾或带尾斜杠）→ 自动追加 trade-journal.jsonl；
   * - 完整文件路径 → 原样；
   * - 相对路径 → 相对进程 cwd 解析为绝对路径。
   */
  normalize(input: string): string {
    const t = String(input ?? '').trim();
    if (!t) throw new Error('存储路径不能为空');
    const abs = isAbsolute(t) ? t : resolve(process.cwd(), t);
    const looksLikeDir = abs.endsWith('/') || !/\.jsonl$/i.test(abs);
    return looksLikeDir ? resolve(abs, 'trade-journal.jsonl') : abs;
  }

  /** 持久化新的主存储路径（先确保目录可写，再写设置文件，最后切换内存值） */
  save(journalPath: string): StoragePaths {
    const next = this.normalize(journalPath);
    mkdirSync(dirname(next), { recursive: true });
    mkdirSync(dirname(this.settingsFile), { recursive: true });
    writeFileSync(this.settingsFile, JSON.stringify({ journalPath: next }, null, 2) + '\n', 'utf8');
    this.journalPath = next;
    return this.get();
  }
}
