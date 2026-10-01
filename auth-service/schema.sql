CREATE TABLE IF NOT EXISTS app_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_flows (
  state TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_results (
  channel TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  encrypted TEXT,
  expires INTEGER NOT NULL
);
