-- Remembered connections: besides its short-lived access token, a connector session holds a
-- single-use refresh token (stored hashed) that the connector exchanges for a new pair before
-- the access token expires. Refresh tokens expire after a period without use; disconnecting
-- revokes the session and both tokens. Neither column is granted to signed-in users.
alter table public.connector_sessions
  add column refresh_token_hash text unique,
  add column refresh_expires_at timestamptz;
