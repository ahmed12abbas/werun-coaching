-- One row per athlete who has linked COROS, replaced on reconnect.
--
-- The same shape as strava_links (0018), plus the two things COROS needs
-- remembered: which of its clusters issued the tokens (a token is only good
-- where it was issued), and the client id the Worker registered there. There
-- is no client secret — COROS's self-service MCP takes a public client.
--
-- Tokens only, never activity data: the Home card reads COROS live.
CREATE TABLE coros_links (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  issuer        TEXT NOT NULL,      -- https://mcpus.coros.com, mcpeu or mcpcn
  client_id     TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,   -- unix seconds
  connected_at  TEXT NOT NULL
);
