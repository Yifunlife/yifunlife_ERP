ALTER TABLE app_users ADD COLUMN username TEXT;
UPDATE app_users SET username = lower(trim(email));
CREATE UNIQUE INDEX app_users_username_unique ON app_users(username);
