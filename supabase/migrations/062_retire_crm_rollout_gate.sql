begin;

-- CRM is a core ZeloChat capability, not a per-company experiment. The
-- legacy column remains because campaigns/automations still use this table,
-- but every existing row is normalized to the always-on CRM state.
update public.zelochat_crm_rollout_flags
set crm_enabled = true,
    updated_at = now();

commit;
