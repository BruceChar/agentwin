// ================= 数据库迁移 =================
// 每次 schema 变更追加一条 { version, sql }，SqliteStorage 启动时按序执行。

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT',
  meta TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS balances (
  account_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  free DOUBLE NOT NULL,
  locked DOUBLE NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (account_id, asset)
);

CREATE TABLE IF NOT EXISTS klines (
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  interval TEXT NOT NULL,
  open_time BIGINT NOT NULL,
  open DOUBLE NOT NULL,
  high DOUBLE NOT NULL,
  low DOUBLE NOT NULL,
  close DOUBLE NOT NULL,
  volume DOUBLE NOT NULL,
  close_time BIGINT NOT NULL,
  quote_volume DOUBLE NOT NULL DEFAULT 0,
  trades BIGINT NOT NULL DEFAULT 0,
  taker_buy_base DOUBLE NOT NULL DEFAULT 0,
  taker_buy_quote DOUBLE NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, market, interval, open_time)
);
CREATE INDEX IF NOT EXISTS idx_klines_lookup ON klines(symbol, market, interval, open_time);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  strategy_id TEXT,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  price REAL,
  quantity DOUBLE NOT NULL,
  filled_qty DOUBLE NOT NULL DEFAULT 0,
  avg_fill_price REAL,
  status TEXT NOT NULL,
  fee REAL,
  fee_asset TEXT,
  meta TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_strategy ON orders(strategy_id, created_at);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  strategy_id TEXT,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  qty DOUBLE NOT NULL,
  price DOUBLE NOT NULL,
  fee DOUBLE NOT NULL DEFAULT 0,
  fee_asset TEXT,
  pnl REAL,
  realized_pnl REAL,
  meta TEXT,
  traded_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id, traded_at);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol, traded_at);

CREATE TABLE IF NOT EXISTS positions (
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity DOUBLE NOT NULL,
  avg_entry_price DOUBLE NOT NULL,
  unrealized_pnl DOUBLE NOT NULL DEFAULT 0,
  realized_pnl DOUBLE NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (account_id, symbol, market)
);

CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  parameters TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  enabled BIGINT NOT NULL DEFAULT 0,
  parent_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS equity_snapshots (
  account_id TEXT NOT NULL,
  ts BIGINT NOT NULL,
  equity DOUBLE NOT NULL,
  cash DOUBLE NOT NULL,
  unrealized_pnl DOUBLE NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, ts)
);

CREATE TABLE IF NOT EXISTS llm_sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  meta TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_messages_session ON llm_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS sentiment (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  symbol TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT,
  url TEXT,
  published_at INTEGER,
  score DOUBLE NOT NULL,
  label TEXT NOT NULL,
  keywords TEXT NOT NULL,
  model TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sentiment_symbol ON sentiment(symbol, created_at);

CREATE TABLE IF NOT EXISTS backtests (
  id TEXT PRIMARY KEY,
  strategy_id TEXT,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  interval TEXT NOT NULL,
  from_ts BIGINT NOT NULL,
  to_ts BIGINT NOT NULL,
  initial_capital DOUBLE NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS _migrations (
  version BIGINT PRIMARY KEY,
  applied_at BIGINT NOT NULL
);
`,
  },
];
