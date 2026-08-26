import { useState } from 'react';
import { Paperclip, Send } from 'lucide-react';
import type { ChatAttachment } from '../../types';

interface Props { disabled?: boolean; canSend: boolean; onSend: (text: string, attachment?: ChatAttachment) => Promise<void>; }

export function ConversationComposer({ disabled = false, canSend, onSend }: Props) {
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<ChatAttachment | undefined>();
  const [sending, setSending] = useState(false);
  const submit = async () => { const value = text.trim(); if ((!value && !attachment) || disabled || !canSend || sending) return; setSending(true); try { await onSend(value, attachment); setText(''); setAttachment(undefined); } finally { setSending(false); } };
  const chooseFile = async (file: File | undefined) => { if (!file) return; const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); setAttachment({ type: file.type.startsWith('image/') ? 'image' : 'document', mimeType: file.type || 'application/octet-stream', fileName: file.name, sizeBytes: file.size, dataUrl }); };
  return <div className="flex items-end gap-2 border-t border-[var(--color-line)] p-3"><label className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--color-surface-muted)]" aria-label="Anexar arquivo"><Paperclip className="h-4 w-4" /><input type="file" className="sr-only" disabled={disabled || !canSend} onChange={(event) => { void chooseFile(event.target.files?.[0]); }} /></label><textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} disabled={disabled || !canSend} placeholder={canSend ? 'Escreva uma mensagem…' : 'Você não tem permissão para enviar'} rows={1} className="max-h-28 min-h-[44px] flex-1 resize-none rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-ink)]" aria-label="Mensagem" /><button type="button" onClick={() => void submit()} disabled={disabled || !canSend || sending || (!text.trim() && !attachment)} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-[var(--color-brand)] text-white disabled:opacity-50" aria-label="Enviar mensagem"><Send className="h-4 w-4" /></button></div>;
}
