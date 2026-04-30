import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { ConfirmModal } from '../../ConfirmModal';
import { Modal, useModalTitleId } from '../../Modal';
import type {
  Categoria,
  Subcategoria,
  ProdutoRow,
  CategoriaInput,
  SubcategoriaInput,
  ProdutoInput,
} from '../../../hooks/useCatalog';

type ModalShellProps = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
};

function ModalShell({ title, subtitle, onClose, children }: ModalShellProps) {
  const titleId = useModalTitleId();

  return (
    <Modal
      open
      onClose={onClose}
      titleId={titleId}
      panelClassName="rounded-2xl bg-white shadow-xl"
    >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-5">
          <div>
            <h3 id={titleId} className="text-base font-bold text-gray-800">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
    </Modal>
  );
}

type ActionBarProps = {
  onCancel: () => void;
  submitLabel: string;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
};

function ActionBar({ onCancel, submitLabel, loading, disabled, destructive }: ActionBarProps) {
  return (
    <div className="mt-6 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={loading || disabled}
        className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-300 ${
          destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-[#25D366] hover:bg-[#1EBE5D]'
        }`}
      >
        {loading ? 'Salvando...' : submitLabel}
      </button>
    </div>
  );
}

const LABEL_CLS = 'block text-[12px] font-semibold text-gray-700 mb-1.5';
const INPUT_CLS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-[#25D366] focus:outline-none focus:ring-2 focus:ring-[#25D366]/20';

// ---------- Categoria ----------
type CategoriaModalProps = {
  open: boolean;
  initial?: Categoria | null;
  onClose: () => void;
  onSubmit: (patch: CategoriaInput) => Promise<void>;
};

export function CategoriaModal({ open, initial, onClose, onSubmit }: CategoriaModalProps) {
  const [nome, setNome] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNome(initial?.nome ?? '');
      setErr(null);
    }
  }, [open, initial]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = nome.trim();
    if (!trimmed) {
      setErr('Informe o nome da categoria.');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      await onSubmit({ nome: trimmed });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title={initial ? 'Editar categoria' : 'Nova categoria'}
      subtitle="Categorias ajudam a IA a organizar seu cardápio."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <label className={LABEL_CLS}>Nome</label>
        <input
          autoFocus
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: Bebidas, Lanches, Sobremesas"
          className={INPUT_CLS}
        />
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
        <ActionBar onCancel={onClose} submitLabel={initial ? 'Salvar' : 'Criar categoria'} loading={loading} />
      </form>
    </ModalShell>
  );
}

// ---------- Subcategoria ----------
type SubcategoriaModalProps = {
  open: boolean;
  initial?: Subcategoria | null;
  defaultCategoriaId?: number | null;
  categorias: Categoria[];
  onClose: () => void;
  onSubmit: (patch: SubcategoriaInput) => Promise<void>;
};

export function SubcategoriaModal({
  open,
  initial,
  defaultCategoriaId,
  categorias,
  onClose,
  onSubmit,
}: SubcategoriaModalProps) {
  const [nome, setNome] = useState('');
  const [idCategoria, setIdCategoria] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNome(initial?.nome ?? '');
      setIdCategoria(initial?.id_categoria ?? defaultCategoriaId ?? (categorias[0]?.id ?? ''));
      setErr(null);
    }
  }, [open, initial, defaultCategoriaId, categorias]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = nome.trim();
    if (!trimmed) {
      setErr('Informe o nome da subcategoria.');
      return;
    }
    if (!idCategoria) {
      setErr('Selecione uma categoria.');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      await onSubmit({ nome: trimmed, id_categoria: Number(idCategoria) });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title={initial ? 'Editar subcategoria' : 'Nova subcategoria'}
      subtitle="Subcategorias dividem uma categoria em seções (ex: Pizzas Doces, Pizzas Salgadas)."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={LABEL_CLS}>Nome</label>
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex: Refrigerantes, Sucos"
            className={INPUT_CLS}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Categoria</label>
          <select
            value={idCategoria}
            onChange={(e) => setIdCategoria(e.target.value === '' ? '' : Number(e.target.value))}
            className={INPUT_CLS}
          >
            <option value="">Selecione...</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>

        {err && <p className="text-xs text-red-600">{err}</p>}
        <ActionBar onCancel={onClose} submitLabel={initial ? 'Salvar' : 'Criar subcategoria'} loading={loading} />
      </form>
    </ModalShell>
  );
}

// ---------- Produto ----------
type ProductModalProps = {
  open: boolean;
  initial?: ProdutoRow | null;
  defaultCategoriaId?: number | null;
  defaultSubcategoriaId?: number | null;
  categorias: Categoria[];
  subcategorias: Subcategoria[];
  onClose: () => void;
  onSubmit: (patch: ProdutoInput) => Promise<void>;
};

export function ProductModal({
  open,
  initial,
  defaultCategoriaId,
  defaultSubcategoriaId,
  categorias,
  subcategorias,
  onClose,
  onSubmit,
}: ProductModalProps) {
  const [nome, setNome] = useState('');
  const [precoStr, setPrecoStr] = useState('');
  const [idCategoria, setIdCategoria] = useState<number | ''>('');
  const [idSubcategoria, setIdSubcategoria] = useState<number | ''>('');
  const [ocultar, setOcultar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNome(initial?.nome ?? '');
      setPrecoStr(initial ? formatPrecoInput(initial.preco) : '');
      setIdCategoria(initial?.id_categoria ?? defaultCategoriaId ?? '');
      setIdSubcategoria(initial?.id_subcategoria ?? defaultSubcategoriaId ?? '');
      setOcultar(initial?.ocultar_no_pdv ?? false);
      setErr(null);
    }
  }, [open, initial, defaultCategoriaId, defaultSubcategoriaId]);

  if (!open) return null;

  const subcategoriasFiltered = subcategorias.filter((s) => (idCategoria ? s.id_categoria === Number(idCategoria) : true));

  const handleCategoriaChange = (v: string) => {
    const newId = v === '' ? '' : Number(v);
    setIdCategoria(newId);
    // Reset subcategoria if it no longer belongs
    if (idSubcategoria && newId) {
      const stillValid = subcategorias.some((s) => s.id === idSubcategoria && s.id_categoria === newId);
      if (!stillValid) setIdSubcategoria('');
    } else if (!newId) {
      setIdSubcategoria('');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = nome.trim();
    if (!trimmed) {
      setErr('Informe o nome do produto.');
      return;
    }
    const preco = parsePrecoInput(precoStr);
    if (Number.isNaN(preco) || preco < 0) {
      setErr('Informe um preço válido.');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      await onSubmit({
        nome: trimmed,
        preco,
        id_categoria: idCategoria ? Number(idCategoria) : null,
        id_subcategoria: idSubcategoria ? Number(idSubcategoria) : null,
        ocultar_no_pdv: ocultar,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title={initial ? 'Editar produto' : 'Novo produto'}
      subtitle="Cadastro rápido — a IA usa esses dados para responder clientes."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={LABEL_CLS}>Nome</label>
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex: X-Tudo, Coca-Cola 2L"
            className={INPUT_CLS}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Preço (R$)</label>
          <input
            value={precoStr}
            onChange={(e) => setPrecoStr(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className={INPUT_CLS}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Categoria</label>
            <select
              value={idCategoria}
              onChange={(e) => handleCategoriaChange(e.target.value)}
              className={INPUT_CLS}
            >
              <option value="">Sem categoria</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS}>Subcategoria</label>
            <select
              value={idSubcategoria}
              onChange={(e) => setIdSubcategoria(e.target.value === '' ? '' : Number(e.target.value))}
              disabled={!idCategoria || subcategoriasFiltered.length === 0}
              className={`${INPUT_CLS} disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400`}
            >
              <option value="">Nenhuma</option>
              {subcategoriasFiltered.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={ocultar}
            onChange={(e) => setOcultar(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-[#25D366] focus:ring-[#25D366]/30"
          />
          Ocultar nos cardápios (produto fica inativo)
        </label>

        <div className="rounded-lg bg-[#F2F3F8] p-3 text-[12px] text-gray-600">
          Para detalhes avançados (estoque, complementos, variações), acesse o{' '}
          <a
            href="https://zelopdv.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-[#0B7A3B] hover:underline"
          >
            ZeloPDV <ExternalLink className="h-3 w-3" />
          </a>
          .
        </div>

        {err && <p className="text-xs text-red-600">{err}</p>}
        <ActionBar onCancel={onClose} submitLabel={initial ? 'Salvar' : 'Criar produto'} loading={loading} />
      </form>
    </ModalShell>
  );
}

// ---------- Confirm Delete ----------
type ConfirmDeleteProps = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function ConfirmDelete({ open, title, message, onClose, onConfirm }: ConfirmDeleteProps) {
  return (
    <ConfirmModal
      open={open}
      title={title}
      message={message}
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel="Excluir"
      confirmLoadingLabel="Excluindo..."
    />
  );
}

// ---------- utils ----------
function formatPrecoInput(preco: number): string {
  if (!Number.isFinite(preco)) return '';
  return preco.toFixed(2).replace('.', ',');
}

function parsePrecoInput(v: string): number {
  const cleaned = v.replace(/\./g, '').replace(',', '.').trim();
  if (!cleaned) return 0;
  return Number(cleaned);
}
