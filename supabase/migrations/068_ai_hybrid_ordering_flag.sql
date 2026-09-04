-- Per-empresa activation flag for the canonical (ZeloMenu) hybrid conversational
-- ordering router. PR 1.1/1.3 (ultra-review-production.md): before this flag,
-- activation was `zelochat_mode != 'general'` + the global `ai_enabled` kill-switch
-- + a process-wide ZELO_INTERNAL_API_KEY — merging this branch could not be made
-- a no-op for an already-live tenant (e.g. Casa dos Salgados) without a redeploy.
--
-- Default false: every existing tenant keeps the pre-hybrid-ordering behavior
-- (generic AI, no canonical requirement/confirmation flow, no ZeloMenu ordering
-- client calls) until an operator/Eng explicitly turns this on for a pilot.
-- There is deliberately no self-service UI toggle for this column — activation
-- is an explicit operator/Eng decision, not a customer-facing setting.
alter table public.empresa_perfil
  add column if not exists ai_hybrid_ordering_enabled boolean not null default false;

comment on column public.empresa_perfil.ai_hybrid_ordering_enabled is
  'ZeloChat-owned. Gates the canonical hybrid WhatsApp ordering router (tryHandleAiWhatsAppOrdering) per empresa. Default false — flip only via direct DB update for an explicit pilot, never a self-service toggle.';
