CREATE TABLE IF NOT EXISTS mail_oauth_states (
  state TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  next_poll_at INTEGER NOT NULL DEFAULT 0,
  poll_interval INTEGER NOT NULL DEFAULT 5
);
CREATE TABLE IF NOT EXISTS mail_connections (
  owner TEXT PRIMARY KEY,
  provider_user_id TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  connected_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trade_documents (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  number TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT NOT NULL,
  pdf_key TEXT NOT NULL,
  pdf_hash TEXT NOT NULL,
  filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  sender TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  sent_at TEXT,
  provider_request_id TEXT,
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS trade_documents_owner_created ON trade_documents(owner, created_at);
