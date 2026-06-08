-- Per-day schedule for the global AI auto-reply.
-- Shape: { "sun": { "enabled": bool, "start": "HH:MM", "end": "HH:MM" }, "mon": {...}, ... }
-- When present (non-null), takes precedence over the legacy
-- ai_schedule_start / ai_schedule_end pair (which still applies the same
-- window to every day). Existing customers stay on the legacy fields until
-- they re-save the schedule from the UI.
alter table public.empresa_perfil
  add column if not exists ai_schedule_days jsonb;
