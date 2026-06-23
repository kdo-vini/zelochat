import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Globe2, ImagePlus, Trash2, X, ExternalLink } from 'lucide-react';
import { ConfirmModal } from '../../ConfirmModal';
import { Modal, useModalTitleId } from '../../Modal';
import type {
  Categoria,
  Subcategoria,
  ProdutoRow,
  ZeloMenuModifierGroupRow,
  ZeloMenuProductPublicationInput,
  ZeloMenuProductPublicationRow,
  CategoriaInput,
  SubcategoriaInput,
  ProdutoInput,
} from '../../../hooks/useCatalog';
import {
  validateModifierGroupDrafts,
  type ZeloMenuModifierGroupDraft,
  type ZeloMenuModifierGroupKind,
} from '../../../domain/zelomenuModifiers';

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
          Para detalhes avançados de estoque e imagens próprias, acesse o{' '}
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

// ---------- Publicação ZeloMenu ----------
type ProductPublicationModalProps = {
  open: boolean;
  product: ProdutoRow | null;
  initial?: ZeloMenuProductPublicationRow | null;
  modifierGroups: ZeloMenuModifierGroupRow[];
  uploadImage: (productId: number, file: File, previousUrl?: string | null) => Promise<string>;
  onClose: () => void;
  onSubmit: (
    patch: ZeloMenuProductPublicationInput,
    modifierGroups: ZeloMenuModifierGroupDraft[],
  ) => Promise<void>;
};

export function ProductPublicationModal({
  open,
  product,
  initial,
  modifierGroups,
  uploadImage,
  onClose,
  onSubmit,
}: ProductPublicationModalProps) {
  const [visivelOnline, setVisivelOnline] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [nomePublico, setNomePublico] = useState('');
  const [descricaoPublica, setDescricaoPublica] = useState('');
  const [fotoUrl, setFotoUrl] = useState('');
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [fotoPreviewUrl, setFotoPreviewUrl] = useState<string | null>(null);
  const [ordem, setOrdem] = useState('0');
  const [groupsDraft, setGroupsDraft] = useState<ZeloMenuModifierGroupDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setVisivelOnline(initial?.visivel_online ?? false);
      setPausado(initial?.pausado_manualmente ?? false);
      setNomePublico(initial?.nome_publico ?? '');
      setDescricaoPublica(initial?.descricao_publica ?? '');
      setFotoUrl(initial?.foto_url ?? '');
      setFotoFile(null);
      setFotoPreviewUrl(null);
      setOrdem(String(initial?.ordem ?? 0));
      setGroupsDraft(modifierGroups.map((group) => ({
        id: group.id,
        name: group.name,
        kind: group.kind,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        active: group.active,
        order: group.order,
        options: group.options.map((option) => ({
          id: option.id,
          name: option.name,
          priceDelta: option.priceDelta,
          active: option.active,
          order: option.order,
        })),
      })));
      setErr(null);
    }
  }, [open, initial, modifierGroups]);

  useEffect(() => () => {
    if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
  }, [fotoPreviewUrl]);

  if (!open || !product) return null;

  const currentPhotoUrl = fotoPreviewUrl ?? (fotoUrl.trim() || null);

  const handlePhotoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErr('Envie uma imagem em PNG, JPG, WEBP ou formato compatível.');
      return;
    }

    if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
    setFotoFile(file);
    setFotoPreviewUrl(URL.createObjectURL(file));
    setFotoUrl('');
    setErr(null);
  };

  const clearPhoto = () => {
    if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
    setFotoFile(null);
    setFotoPreviewUrl(null);
    setFotoUrl('');
    setErr(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsedOrder = Number.parseInt(ordem, 10);
    if (!Number.isFinite(parsedOrder) || parsedOrder < 0) {
      setErr('Informe uma ordem válida.');
      return;
    }

    const trimmedFoto = fotoUrl.trim();
    if (trimmedFoto && !/^https:\/\//i.test(trimmedFoto)) {
      setErr('Use um link de foto começando com https://.');
      return;
    }

    const draftError = validateModifierGroupDrafts(groupsDraft);
    if (draftError) {
      setErr(draftError);
      return;
    }

    setLoading(true);
    setErr(null);
    try {
      const uploadedPhotoUrl = fotoFile
        ? await uploadImage(product.id, fotoFile, initial?.foto_url ?? null)
        : trimmedFoto || null;
      await onSubmit(
        {
          visivel_online: visivelOnline,
          pausado_manualmente: visivelOnline ? pausado : false,
          nome_publico: nomePublico,
          descricao_publica: descricaoPublica,
          foto_url: uploadedPhotoUrl,
          ordem: parsedOrder,
        },
        groupsDraft,
      );
      onClose();
    } catch {
      setErr('Não foi possível salvar a publicação. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title="Publicação no ZeloMenu"
      subtitle="Controle como este produto aparece no link do cardápio."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#25D366]/10 text-[#0B7A3B]">
              <Globe2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-800">{product.nome}</p>
              <p className="text-xs text-gray-500">Produto base do cardápio operacional.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={visivelOnline}
              onChange={(e) => setVisivelOnline(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#25D366] focus:ring-[#25D366]/30"
            />
            <span>
              <span className="block font-semibold text-gray-800">Publicado no ZeloMenu</span>
              <span className="text-xs text-gray-500">Aparece no link do cardápio quando estiver disponível.</span>
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={pausado}
              disabled={!visivelOnline}
              onChange={(e) => setPausado(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#25D366] focus:ring-[#25D366]/30 disabled:cursor-not-allowed disabled:opacity-40"
            />
            <span>
              <span className="block font-semibold text-gray-800">Pausar temporariamente</span>
              <span className="text-xs text-gray-500">Mantém configurado, mas esconde do link por enquanto.</span>
            </span>
          </label>
        </div>

        <div>
          <label className={LABEL_CLS}>Nome público</label>
          <input
            value={nomePublico}
            onChange={(e) => setNomePublico(e.target.value)}
            placeholder={product.nome}
            className={INPUT_CLS}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Descrição pública</label>
          <textarea
            value={descricaoPublica}
            onChange={(e) => setDescricaoPublica(e.target.value)}
            placeholder="Ingredientes, tamanho ou detalhe importante para o cliente."
            rows={3}
            className={`${INPUT_CLS} min-h-24 resize-y`}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <div className="space-y-3">
            <div>
              <label className={LABEL_CLS}>Foto do produto</label>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                  <ImagePlus className="h-4 w-4" />
                  Enviar imagem
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={handlePhotoFileChange}
                  />
                </label>
                {currentPhotoUrl ? (
                  <button
                    type="button"
                    onClick={clearPhoto}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remover foto
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                Envie uma imagem própria ou cole um link HTTPS. A foto enviada fica salva na sua conta.
              </p>
            </div>

            {currentPhotoUrl ? (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                <img
                  src={currentPhotoUrl}
                  alt=""
                  className="h-40 w-full object-cover"
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
                Nenhuma foto selecionada.
              </div>
            )}

            <div>
              <label className={LABEL_CLS}>Ou use um link de foto</label>
              <input
                value={fotoUrl}
                onChange={(e) => {
                  if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
                  setFotoFile(null);
                  setFotoPreviewUrl(null);
                  setFotoUrl(e.target.value);
                }}
                placeholder="https://..."
                className={INPUT_CLS}
              />
            </div>
          </div>
          <div>
            <label className={LABEL_CLS}>Ordem</label>
            <input
              type="number"
              min={0}
              step={1}
              value={ordem}
              onChange={(e) => setOrdem(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">Adicionais e variações</p>
              <p className="text-xs text-gray-500">
                O cliente escolhe essas opções antes de confirmar o pedido.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setGroupsDraft((prev) => [...prev, createEmptyModifierGroup(prev.length)])}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
            >
              Novo grupo
            </button>
          </div>

          {groupsDraft.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-4 text-center text-xs text-gray-500">
              Nenhum adicional ou variação configurado ainda.
            </div>
          ) : (
            <div className="space-y-3">
              {groupsDraft.map((group, groupIndex) => (
                <div key={group.id ?? `group-${groupIndex}`}>
                  <ModifierGroupEditor
                    group={group}
                    onChange={(nextGroup) => {
                      setGroupsDraft((prev) => prev.map((entry, index) => index === groupIndex ? nextGroup : entry));
                    }}
                    onDelete={() => {
                      setGroupsDraft((prev) => prev.filter((_, index) => index !== groupIndex));
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {err && <p className="text-xs text-red-600">{err}</p>}
        <ActionBar onCancel={onClose} submitLabel="Salvar publicação" loading={loading} />
      </form>
    </ModalShell>
  );
}

function ModifierGroupEditor({
  group,
  onChange,
  onDelete,
}: {
  group: ZeloMenuModifierGroupDraft;
  onChange: (group: ZeloMenuModifierGroupDraft) => void;
  onDelete: () => void;
}) {
  const updateGroup = (patch: Partial<ZeloMenuModifierGroupDraft>) => {
    onChange({ ...group, ...patch });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className={LABEL_CLS}>Nome do grupo</span>
          <input
            value={group.name}
            onChange={(event) => updateGroup({ name: event.target.value })}
            placeholder="Ex.: Escolha o recheio"
            className={INPUT_CLS}
          />
        </label>

        <label className="space-y-1.5">
          <span className={LABEL_CLS}>Tipo</span>
          <select
            value={group.kind}
            onChange={(event) => updateGroup({ kind: event.target.value as ZeloMenuModifierGroupKind })}
            className={INPUT_CLS}
          >
            <option value="adicional">Adicional</option>
            <option value="variacao">Variação</option>
          </select>
        </label>

        <label className="space-y-1.5">
          <span className={LABEL_CLS}>Mínimo</span>
          <input
            type="number"
            min={0}
            value={String(group.minSelections)}
            onChange={(event) => updateGroup({ minSelections: Number(event.target.value || 0) })}
            className={INPUT_CLS}
          />
        </label>

        <label className="space-y-1.5">
          <span className={LABEL_CLS}>Máximo</span>
          <input
            type="number"
            min={1}
            value={group.maxSelections == null ? '' : String(group.maxSelections)}
            onChange={(event) => updateGroup({
              maxSelections: event.target.value === '' ? null : Number(event.target.value || 1),
            })}
            className={INPUT_CLS}
            placeholder="Sem limite"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={group.active}
            onChange={(event) => updateGroup({ active: event.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-[#25D366] focus:ring-[#25D366]/30"
          />
          Grupo ativo no link
        </label>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
        >
          Remover grupo
        </button>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Opções</p>
          <button
            type="button"
            onClick={() => onChange({
              ...group,
              options: [...group.options, createEmptyModifierOption(group.options.length)],
            })}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
          >
            Nova opção
          </button>
        </div>

        {group.options.map((option, optionIndex) => (
          <div key={option.id ?? `option-${optionIndex}`} className="grid gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3 md:grid-cols-[minmax(0,1fr)_140px_auto]">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold text-gray-500">Nome</span>
              <input
                value={option.name}
                onChange={(event) => onChange({
                  ...group,
                  options: group.options.map((entry, index) => index === optionIndex ? { ...entry, name: event.target.value } : entry),
                })}
                placeholder="Ex.: Catupiry"
                className={INPUT_CLS}
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] font-semibold text-gray-500">Adicional (R$)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={String(option.priceDelta)}
                onChange={(event) => onChange({
                  ...group,
                  options: group.options.map((entry, index) => index === optionIndex ? { ...entry, priceDelta: Number(event.target.value || 0) } : entry),
                })}
                className={INPUT_CLS}
              />
            </label>

            <div className="flex items-end justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={option.active}
                  onChange={(event) => onChange({
                    ...group,
                    options: group.options.map((entry, index) => index === optionIndex ? { ...entry, active: event.target.checked } : entry),
                  })}
                  className="h-4 w-4 rounded border-gray-300 text-[#25D366] focus:ring-[#25D366]/30"
                />
                Ativa
              </label>
              <button
                type="button"
                onClick={() => onChange({
                  ...group,
                  options: group.options.filter((_, index) => index !== optionIndex),
                })}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function createEmptyModifierGroup(order: number): ZeloMenuModifierGroupDraft {
  return {
    name: '',
    kind: 'adicional',
    minSelections: 0,
    maxSelections: null,
    active: true,
    order,
    options: [createEmptyModifierOption(0)],
  };
}

function createEmptyModifierOption(order: number) {
  return {
    name: '',
    priceDelta: 0,
    active: true,
    order,
  };
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
