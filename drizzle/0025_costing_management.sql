CREATE TABLE IF NOT EXISTS costing_rule_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  previous_id INTEGER NOT NULL UNIQUE,
  settings_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS costing_records (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  project_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS costing_records_created_at ON costing_records(created_at);
