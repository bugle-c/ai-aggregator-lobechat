-- Short-lived codes for the bot-mediated TG-link deep link.
-- WHY: Telegram's /start deep-link param is capped at 64 chars and only
-- allows [A-Za-z0-9_-]. The old HMAC token was 127 chars and contained a
-- '.', so `t.me/<bot>?start=link_<token>` was always malformed → the link
-- never completed. We now pass a short opaque code and store the mapping
-- server-side.
CREATE TABLE IF NOT EXISTS public.tg_link_codes (
  code        text PRIMARY KEY,
  user_id     text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tg_link_codes_expires ON public.tg_link_codes (expires_at);
