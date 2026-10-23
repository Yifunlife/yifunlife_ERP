ALTER TABLE app_users ADD COLUMN recovery_email TEXT;
ALTER TABLE app_users ADD COLUMN recovery_email_verified_at TEXT;
UPDATE app_users SET recovery_email = lower(trim(email)) WHERE email LIKE '%@%';
CREATE UNIQUE INDEX app_users_recovery_email_unique ON app_users(recovery_email);
CREATE TABLE email_verification_tokens (owner TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
