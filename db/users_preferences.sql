-- Users and auth settings only. Review/project data is intentionally excluded.

CREATE TABLE IF NOT EXISTS auth_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  registration_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkout_window_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  screening_checkout_window_minutes INTEGER NOT NULL DEFAULT 60,
  extraction_checkout_window_minutes INTEGER NOT NULL DEFAULT 120,
  pdf_upload_max_size_mb INTEGER NOT NULL DEFAULT 50,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE checkout_window_settings
  ADD COLUMN IF NOT EXISTS pdf_upload_max_size_mb INTEGER NOT NULL DEFAULT 50;


CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  initials TEXT NOT NULL,
  organization TEXT NOT NULL,
  title TEXT NOT NULL,
  timezone TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  website_theme TEXT NOT NULL CHECK (website_theme IN ('light', 'dark', 'system')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS app_users_email_idx ON app_users (email);
