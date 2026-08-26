import { useState } from 'react';
import type { CustomerDetail, CustomerPatch } from '../../services/customerApi';

interface Props { customer: CustomerDetail; onSave: (patch: CustomerPatch) => Promise<void>; onClose: () => void; }

export function CustomerEditDialog({ customer, onSave, onClose }: Props) {
  const [name, setName] = useState(customer.name);
  const [phones, setPhones] = useState(customer.phone ?? customer.whatsapp ?? '');
  const [birthday, setBirthday] = useState(customer.birthday ? `${customer.birthday.year ?? 2000}-${String(customer.birthday.month).padStart(2, '0')}-${String(customer.birthday.day).padStart(2, '0')}` : '');
  const [notes, setNotes] = useState(customer.notes ?? '');
  const [tags, setTags] = useState(customer.tags.join(', '));
  const [blocked, setBlocked] = useState(customer.relationship.blocked);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const [year, month, day] = birthday.split('-').map(Number);
      await onSave({ name, phones: phones.split(',').map((item) => item.trim()).filter(Boolean), birthday: birthday ? { day, month, year } : null, notes, tags: tags.split(',').map((item) => item.trim()).filter(Boolean), whatsappBlocked: blocked });
      onClose();
    } finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-4" role="dialog" aria-modal="true" aria-labelledby="customer-edit-title"><div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--color-surface)] p-4 md:max-w-md md:rounded-2xl"><h2 id="customer-edit-title" className="mb-4 text-[16px] font-semibold text-[var(--color-ink)]">Editar cliente</h2><label className="mb-3 block text-[12px] text-[var(--color-ink-muted)]">Nome<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--color-line)] px-3 text-[14px] text-[var(--color-ink)]" /></label><label className="mb-3 block text-[12px] text-[var(--color-ink-muted)]">Telefones<input value={phones} onChange={(event) => setPhones(event.target.value)} placeholder="Separe por vírgula" className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--color-line)] px-3 text-[14px] text-[var(--color-ink)]" /></label><label className="mb-3 block text-[12px] text-[var(--color-ink-muted)]">Aniversário<input type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--color-line)] px-3 text-[14px] text-[var(--color-ink)]" /></label><label className="mb-3 block text-[12px] text-[var(--color-ink-muted)]">Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="vip, aniversário" className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--color-line)] px-3 text-[14px] text-[var(--color-ink)]" /></label><label className="mb-3 block text-[12px] text-[var(--color-ink-muted)]">Notas internas<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} className="mt-1 min-h-[88px] w-full rounded-lg border border-[var(--color-line)] p-3 text-[14px] text-[var(--color-ink)]" /></label><label className="mb-4 flex min-h-[44px] items-center gap-3 text-[13px] text-[var(--color-ink)]"><input type="checkbox" checked={blocked} onChange={(event) => setBlocked(event.target.checked)} className="h-4 w-4" />Bloquear WhatsApp</label><div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="min-h-[44px] rounded-lg px-3 text-[13px]">Cancelar</button><button type="button" onClick={() => void submit()} disabled={saving} className="min-h-[44px] rounded-lg bg-[var(--color-brand)] px-4 text-[13px] font-medium text-white">{saving ? 'Salvando…' : 'Salvar'}</button></div></div></div>;
}
