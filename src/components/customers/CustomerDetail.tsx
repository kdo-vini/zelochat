import { useEffect, useState } from 'react';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { deleteCustomer, fetchCustomer, updateCustomer, updateCustomerOrderingOverrides, type CustomerDetail as CustomerDetailData, type CustomerOrderingOverridesPatch, type CustomerPatch, type CustomerSummary } from '../../services/customerApi';
import { CustomerOrdersTab } from './CustomerOrdersTab';
import { CustomerRelationshipTab } from './CustomerRelationshipTab';
import { CustomerSummaryTab } from './CustomerSummaryTab';
import { CustomerEditDialog } from './CustomerEditDialog';
import { CustomerMessagesTab } from './CustomerMessagesTab';
import type { CustomerMessagePermission } from '../../domain/customerMessages';
import { useDialogFocus } from '../../hooks/useDialogFocus';

interface Props { token: string | null; summary: CustomerSummary; onBack: () => void; permissions?: CustomerMessagePermission; primaryJid?: string | null; onOpenAtendimento?: (sessionId: string) => void; canManage?: boolean; }
type Tab = 'summary' | 'messages' | 'orders' | 'relationship';

export function CustomerDetail({ token, summary, onBack, permissions = { pessoasVisualizar: false, clientesComunicar: false }, primaryJid, onOpenAtendimento, canManage = false }: Props) {
  const [customer, setCustomer] = useState<CustomerDetailData | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!token) return; let cancelled = false; void fetchCustomer(token, summary.id).then((value) => { if (!cancelled) setCustomer(value); }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a ficha.'); }); return () => { cancelled = true; }; }, [summary.id, token]);
  const save = async (patch: CustomerPatch) => { if (!token || !customer) return; setCustomer(await updateCustomer(token, customer.id, patch)); };
  const saveOrderingOverrides = async (patch: CustomerOrderingOverridesPatch) => {
    if (!token || !customer) return;
    const orderingContext = await updateCustomerOrderingOverrides(token, customer.id, patch);
    setCustomer((current) => current ? { ...current, orderingContext } : current);
  };
  const remove = async () => { if (!token || !customer) return; try { await deleteCustomer(token, customer.id); onBack(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível excluir o cliente.'); setConfirmingDelete(false); } };
  if (error) return <div className="flex flex-1 flex-col p-4"><button type="button" onClick={onBack} className="mb-4 inline-flex min-h-[44px] items-center gap-2 self-start text-[13px]"><ArrowLeft className="h-4 w-4" />Voltar</button><div role="alert" className="rounded-xl border border-[var(--color-line)] p-4 text-[13px] text-[var(--color-alert)]">{error}</div></div>;
  if (!customer) return <div role="status" className="flex flex-1 items-center justify-center text-[13px] text-[var(--color-ink-muted)]">Carregando ficha…</div>;
  const customerPrimaryJid = primaryJid ?? customer.primaryJid ?? null;
  return <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)]"><header className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3"><button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-[13px]"><ArrowLeft className="h-4 w-4" />Voltar</button><div className="min-w-0 flex-1"><h2 className="truncate text-[16px] font-semibold text-[var(--color-ink)]">{customer.name || 'Sem nome'}</h2><p className="truncate text-[12px] text-[var(--color-ink-muted)]">{customer.whatsapp || 'Sem WhatsApp'}</p></div>{canManage && <><button type="button" onClick={() => setEditing(true)} aria-label="Editar cliente" className="min-h-[44px] min-w-[44px] rounded-lg"><Pencil className="mx-auto h-4 w-4" /></button><button type="button" onClick={() => setConfirmingDelete(true)} aria-label="Excluir cliente" className="min-h-[44px] min-w-[44px] rounded-lg text-[var(--color-alert)]"><Trash2 className="mx-auto h-4 w-4" /></button></>}</header><nav className="flex border-b border-[var(--color-line)] px-2" aria-label="Abas do cliente">{([['summary', 'Resumo'], ['messages', 'Mensagens'], ['orders', 'Pedidos'], ['relationship', 'Relacionamento']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} aria-selected={tab === id} role="tab" className={`min-h-[44px] flex-1 px-2 text-[12px] font-medium ${tab === id ? 'border-b-2 border-[var(--color-brand)] text-[var(--color-brand-deep)]' : 'text-[var(--color-ink-muted)]'}`}>{label}</button>)}</nav><div className="min-h-0 flex-1 overflow-y-auto">{tab === 'summary' && <CustomerSummaryTab customer={customer} canManage={canManage} onUpdateOrderingOverrides={saveOrderingOverrides} />}{tab === 'messages' && <CustomerMessagesTab token={token} personId={customer.id} primaryJid={customerPrimaryJid} sessions={customer.sessions} permissions={permissions} onOpenAtendimento={onOpenAtendimento} />}{tab === 'orders' && <CustomerOrdersTab customer={customer} />}{tab === 'relationship' && <CustomerRelationshipTab customer={customer} />}</div>{editing && <CustomerEditDialog customer={customer} onSave={save} onClose={() => setEditing(false)} />}{confirmingDelete && <DeleteDialog onCancel={() => setConfirmingDelete(false)} onConfirm={() => void remove()} />}</div>;
}

function DeleteDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) { useDialogFocus(onCancel); return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="customer-delete-title"><div className="w-full max-w-md rounded-2xl bg-[var(--color-surface)] p-5"><h2 id="customer-delete-title" className="text-[16px] font-semibold text-[var(--color-ink)]">Excluir cliente?</h2><p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">As conversas e o relacionamento serão removidos. Pedidos e vendas serão preservados sem vínculo.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} className="min-h-[44px] rounded-lg px-3 text-[13px]">Cancelar</button><button type="button" onClick={onConfirm} className="min-h-[44px] rounded-lg bg-[var(--color-alert)] px-4 py-2 text-[13px] font-medium text-white">Excluir</button></div></div></div>; }
