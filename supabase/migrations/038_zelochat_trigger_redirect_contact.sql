-- Feature: custom trigger that redirects the customer to another WhatsApp number.
-- ZeloChat owns zelochat_triggers, so this migration is safe from this repo.

ALTER TABLE public.zelochat_triggers
  DROP CONSTRAINT IF EXISTS zelochat_triggers_kind_check;

ALTER TABLE public.zelochat_triggers
  ADD CONSTRAINT zelochat_triggers_kind_check
  CHECK (kind IN ('notify_manager', 'escalate_human', 'redirect_contact'));

ALTER TABLE public.zelochat_triggers
  ADD COLUMN IF NOT EXISTS redirect_phone text,
  ADD COLUMN IF NOT EXISTS redirect_message text;

ALTER TABLE public.zelochat_triggers
  DROP CONSTRAINT IF EXISTS zelochat_triggers_redirect_phone_required;

ALTER TABLE public.zelochat_triggers
  ADD CONSTRAINT zelochat_triggers_redirect_phone_required
  CHECK (kind <> 'redirect_contact' OR nullif(btrim(redirect_phone), '') IS NOT NULL);
