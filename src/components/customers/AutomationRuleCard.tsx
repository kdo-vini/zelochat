import { History, Pencil, Power, Send } from 'lucide-react';
import { canEnableAutomation } from '../../domain/customerAutomation';
import { getAutomationLabel, type AutomationRule } from '../../services/customerAutomationApi';

interface Props {
  key?: string;
  rule: AutomationRule;
  canCommunicate: boolean;
  busy?: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onTest: () => void;
  onHistory: () => void;
}

export function AutomationRuleCard({ rule, canCommunicate, busy = false, onEdit, onToggle, onTest, onHistory }: Props) {
  const valid = canEnableAutomation({ message: rule.message, sendStart: rule.sendStart, sendEnd: rule.sendEnd, audience: rule.audience, dailyLimit: rule.dailyLimit });
  const disconnected = rule.whatsappConnected === false || rule.pausedReason === 'whatsapp_disconnected';
  return <article className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4" aria-label={getAutomationLabel(rule.kind)}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-[15px] font-semibold text-[var(--color-ink)]">{getAutomationLabel(rule.kind)}</h3><p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">{rule.kind === 'birthday' ? 'Envie uma mensagem especial no aniversário.' : rule.kind === 'reactivation' ? 'Relembre clientes que estão há um tempo sem comprar.' : rule.kind === 'post_purchase' ? 'Acompanhe o cliente depois de um pedido entregue.' : rule.kind === 'vip' ? 'Reconheça clientes frequentes e de maior valor.' : 'Recupere carrinhos que ficaram pelo caminho.'}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${rule.enabled && !disconnected ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]'}`}>{disconnected ? 'Pausada' : rule.enabled ? 'Ativa' : 'Desativada'}</span></div>
    {disconnected && <p className="mt-3 rounded-lg bg-[var(--color-surface-muted)] p-3 text-[12px] text-[var(--color-ink-muted)]">Pausada porque o WhatsApp está desconectado. Reconecte para retomar os envios.</p>}
    <dl className="mt-4 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3"><div className="rounded-lg bg-[var(--color-surface-muted)] p-3"><dt className="text-[var(--color-ink-faint)]">Horário</dt><dd className="mt-1 font-medium text-[var(--color-ink)]">{rule.sendStart}–{rule.sendEnd}</dd></div><div className="rounded-lg bg-[var(--color-surface-muted)] p-3"><dt className="text-[var(--color-ink-faint)]">Público</dt><dd className="mt-1 truncate font-medium text-[var(--color-ink)]" title={rule.audience}>{rule.audience}</dd></div><div className="rounded-lg bg-[var(--color-surface-muted)] p-3"><dt className="text-[var(--color-ink-faint)]">Limite diário</dt><dd className="mt-1 font-medium text-[var(--color-ink)]">{rule.dailyLimit}</dd></div></dl>
    {!valid && !rule.enabled && <p className="mt-3 text-[12px] text-[var(--color-ink-muted)]">Revise mensagem, horário, público e limite para ativar.</p>}
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={!canCommunicate || busy || (rule.enabled && disconnected)} onClick={onToggle} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 text-[12px] font-medium text-white disabled:opacity-50"><Power className="h-4 w-4" aria-hidden="true" />{rule.enabled ? 'Desativar' : 'Ativar'}</button><button type="button" disabled={!canCommunicate || busy} onClick={onEdit} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 text-[12px] text-[var(--color-ink)] disabled:opacity-50"><Pencil className="h-4 w-4" aria-hidden="true" />Editar</button><button type="button" disabled={!canCommunicate || busy || !rule.message.trim()} onClick={onTest} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 text-[12px] text-[var(--color-ink)] disabled:opacity-50"><Send className="h-4 w-4" aria-hidden="true" />Testar no meu número</button><button type="button" disabled={!canCommunicate || busy} onClick={onHistory} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-[12px] text-[var(--color-brand-deep)] disabled:opacity-50"><History className="h-4 w-4" aria-hidden="true" />Histórico</button></div>
  </article>;
}
