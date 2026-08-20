import type { StorageAdapter } from './storage.ts';
import { SqliteStorage } from './sqlite.ts';
import { DuckdbStorage } from './duckdb.ts';

export interface StorageOptions {
  /** sqlite (默认) | duckdb | postgres */
  engine?: 'sqlite' | 'duckdb' | 'postgres';
  /** sqlite 文件路径或 ':memory:'；缺省取 DB_PATH 或 ./data/agentwin.db */
  path?: string;
  /** postgres 连接串（预留） */
  url?: string;
}

/**
 * 存储工厂：按需选择具体实现。
 * 目前内置 SQLite（零依赖）；DuckDB/Postgres 适配按需补充后在此注册。
 */
export function createStorage(opts: StorageOptions = {}): StorageAdapter {
  const engine = opts.engine ?? process.env.DB_ENGINE ?? 'sqlite';
  switch (engine) {
    case 'sqlite': {
      const path = opts.path ?? process.env.DB_PATH ?? './data/agentwin.db';
      return new SqliteStorage(path);
    }
    case 'duckdb': {
      const path = opts.path ?? process.env.DB_PATH ?? './data/agentwin.duckdb';
      return new DuckdbStorage(path);
    }
    case 'postgres':
      throw new Error('postgres adapter not implemented yet — implement PostgresStorage and register it here');
    default:
      throw new Error('unknown storage engine: ' + engine);
  }
}
