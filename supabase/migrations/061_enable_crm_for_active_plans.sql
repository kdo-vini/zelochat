begin;

-- Clientes faz parte do plano ZeloChat. A ativação é limitada a contas
-- ativas/em teste; campanhas e automações continuam sob rollout separado.
insert into public.zelochat_crm_rollout_flags (
  empresa_id,
  crm_enabled,
  campaigns_enabled,
  automations_enabled,
  updated_at
)
select
  ep.id,
  true,
  false,
  false,
  now()
from public.empresa_perfil ep
where exists (
  select 1
  from public.subscriptions s
  where s.user_id = ep.user_id
    and s.status in ('active', 'trialing')
)
on conflict (empresa_id) do update
set crm_enabled = true,
    updated_at = now();

commit;
