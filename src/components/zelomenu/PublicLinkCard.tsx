import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2 } from 'lucide-react';
import { getZeloMenuSlug, setZeloMenuSlug } from '../../services/waApi';
import { normalizeZeloMenuSlug } from '../../domain/zelomenuSlug';

/**
 * ZLM-203 — card de configuração do link público do ZeloMenu (self-service, D-046).
 * Auto-contido: gerencia o próprio estado e fala com /api/zelomenu/slug.
 */
export function PublicLinkCard({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getZeloMenuSlug(token);
        if (!active) return;
        setSlug(res.slug);
        setPublicUrl(res.publicUrl);
        setDraft(res.slug ?? '');
      } catch {
        // silencioso — o card só não pré-carrega
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  const preview = normalizeZeloMenuSlug(draft);
  const dirty = (preview ?? '') !== (slug ?? '');

  async function save() {
    if (!preview) {
      setError('Use de 3 a 40 letras, números ou hífens.');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const res = await setZeloMenuSlug(token, preview);
      setSlug(res.slug);
      setPublicUrl(res.publicUrl);
      setDraft(res.slug ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui salvar o link.');
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard indisponível — ignora
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)]">
          <Link2 className="h-5 w-5 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-[var(--color-ink)]">Link público do cardápio</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Escolha um endereço fácil e compartilhe. Seus clientes pedem direto pelo link, sem conversar antes.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-[13px] text-[var(--color-ink-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> Carregando…
        </div>
      ) : (
        <div className="space-y-3">
          {publicUrl ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-ink-soft)]">{publicUrl}</span>
              <button
                type="button"
                onClick={() => void copy()}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-[var(--color-brand-deep)] hover:bg-[var(--color-brand-soft)]"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <label className="flex-1 space-y-1.5">
              <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Seu endereço</span>
              <div className="flex items-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3">
                <span className="text-[13px] text-[var(--color-ink-faint)]">menu.zelopdv.com.br/</span>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="casa-dos-salgados"
                  className="h-11 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
                />
              </div>
              {preview && preview !== draft ? (
                <span className="text-[11.5px] text-[var(--color-ink-muted)]">Vai ficar: <strong>{preview}</strong></span>
              ) : null}
            </label>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty || !preview}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--color-brand)] px-4 text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[var(--color-line-strong)]"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : 'Salvar'}
            </button>
          </div>

          {error ? (
            <p className="text-[12.5px] text-[var(--color-alert)]">{error}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
