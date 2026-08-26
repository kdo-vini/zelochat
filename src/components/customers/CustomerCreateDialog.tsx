import { useState } from 'react';
import type { CustomerPatch } from '../../services/customerApi';

interface Props { onCreate: (patch: CustomerPatch) => Promise<void>; onClose: () => void; }

export function CustomerCreateDialog({ onCreate, onClose }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthday, setBirthday] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const [year, month, day] = birthday.split('-').map(Number);
      await onCreate({ name, phones: phone.split(',').map((item) => item.trim()).filter(Boolean), birthday: birthday ? { day, month, year } : null });
    } finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-4" role="dialog" aria-modal="true" aria-labelledby="customer-create-title"><div className="w-full rounded-t-2xl bg-[var(--color-surface)] p-4 md:max-w-md md:rounded-2xl"><h2 id="customer-create-title" className="mb-4 text-[16px] font-semibold text-[var(--color-ink)]">Novo cliente</h2><label className="mb-3 block text-[12px] text-[var(--color-ink-muted)]">Nome<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--color-line)] px-3 text-[14px] text-[var(--color-ink)]" /></label><label className="mb-3 block text-[12px] text-[var(--color-ink-muted)]">WhatsApp ou telefone<input value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--color-line)] px-3 text-[14px] text-[var(--color-ink)]" /></label><label className="mb-4 block text-[12px] text-[var(--color-ink-muted)]">Aniversário<input type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--color-line)] px-3 text-[14px] text-[var(--color-ink)]" /></label><div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="min-h-[44px] rounded-lg px-3 text-[13px]">Cancelar</button><button type="button" onClick={() => void submit()} disabled={saving || !name.trim()} className="min-h-[44px] rounded-lg bg-[var(--color-brand)] px-4 text-[13px] font-medium text-white">{saving ? 'Salvando…' : 'Criar cliente'}</button></div></div></div>;
}
