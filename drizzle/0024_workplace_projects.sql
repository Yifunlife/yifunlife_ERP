CREATE TABLE IF NOT EXISTS workplace_projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  allowed_emails TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
