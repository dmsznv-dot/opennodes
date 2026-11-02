-- Per-workflow webhook HMAC secret, stored as an AES-256-GCM envelope.
-- HMAC verification needs the secret itself, so it cannot be hashed.
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS webhook_secret_encrypted JSONB;
