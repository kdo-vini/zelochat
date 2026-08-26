-- CRM FK indexes for tenant-safe deletes and relationship/audience lookups.
-- Keep this migration additive; browser roles remain denied on CRM tables.

create index if not exists zelochat_sessions_empresa_owner_idx
  on public.zelochat_sessions (empresa_id, owner_user_id);

create index if not exists zelochat_sessions_owner_person_idx
  on public.zelochat_sessions (owner_user_id, pessoa_id)
  where pessoa_id is not null;

create index if not exists zelochat_customer_relationships_empresa_owner_idx
  on public.zelochat_customer_relationships (empresa_id, id_usuario);

create index if not exists zelochat_customer_relationships_person_owner_idx
  on public.zelochat_customer_relationships (id_usuario, pessoa_id);

create index if not exists zelochat_customer_relationships_updated_by_idx
  on public.zelochat_customer_relationships (updated_by)
  where updated_by is not null;

create index if not exists zelochat_person_tags_empresa_owner_idx
  on public.zelochat_person_tags (empresa_id, id_usuario);

create index if not exists zelochat_person_tags_person_owner_idx
  on public.zelochat_person_tags (id_usuario, pessoa_id);

create index if not exists zelochat_person_match_conflicts_resolved_by_idx
  on public.zelochat_person_match_conflicts (resolved_by)
  where resolved_by is not null;

create index if not exists zelochat_segments_empresa_owner_idx
  on public.zelochat_segments (empresa_id, id_usuario);

create index if not exists zelochat_segments_created_by_idx
  on public.zelochat_segments (created_by)
  where created_by is not null;

create index if not exists zelochat_campaigns_empresa_owner_idx
  on public.zelochat_campaigns (empresa_id, id_usuario);

create index if not exists zelochat_campaigns_segment_idx
  on public.zelochat_campaigns (segment_id)
  where segment_id is not null;

create index if not exists zelochat_campaigns_created_by_idx
  on public.zelochat_campaigns (created_by)
  where created_by is not null;

create index if not exists zelochat_campaign_recipients_empresa_person_idx
  on public.zelochat_campaign_recipients (empresa_id, pessoa_id, status, created_at desc);

create index if not exists zelochat_outbound_jobs_campaign_idx
  on public.zelochat_outbound_jobs (campaign_id)
  where campaign_id is not null;

create index if not exists zelochat_outbound_jobs_recipient_idx
  on public.zelochat_outbound_jobs (recipient_id)
  where recipient_id is not null;

create index if not exists zelochat_automation_rules_empresa_owner_idx
  on public.zelochat_automation_rules (empresa_id, id_usuario);

create index if not exists zelochat_automation_dispatches_outbound_job_idx
  on public.zelochat_automation_dispatches (outbound_job_id)
  where outbound_job_id is not null;

create index if not exists zelochat_crm_rollout_flags_updated_by_idx
  on public.zelochat_crm_rollout_flags (updated_by)
  where updated_by is not null;
