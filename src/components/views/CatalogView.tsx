import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  EyeOff,
  FolderPlus,
  Globe2,
  Pencil,
  PauseCircle,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  ExternalLink,
  X,
} from 'lucide-react';
import type {
  Categoria,
  ProdutoRow,
  Subcategoria,
  ZeloMenuModifierGroupRow,
  ZeloMenuProductPublicationInput,
  ZeloMenuProductPublicationRow,
} from '../../hooks/useCatalog';
import { useCatalogBulkController } from '../../hooks/useCatalogBulkController';
import type { ZeloMenuModifierGroupDraft } from '../../domain/zelomenuModifiers';
import {
  getZeloMenuPublicationStatus,
  summarizeZeloMenuPublication,
  type ZeloMenuPublicationProduct,
  type ZeloMenuPublicationStatus,
} from '../../domain/zelomenuPublication';
import {
  CategoriaModal,
  ConfirmDelete,
  ProductModal,
  ProductPublicationModal,
  SubcategoriaModal,
} from './catalog/CatalogModals';

interface Props {
  isAuthenticated: boolean;
  authLoading: boolean;
  canPublishToMenu: boolean;
  loading: boolean;
  error: string | null;
  categorias: Categoria[];
  subcategorias: Subcategoria[];
  produtos: ProdutoRow[];
  productPublications: Record<number, ZeloMenuProductPublicationRow>;
  productModifierGroups: Record<number, ZeloMenuModifierGroupRow[]>;
  refresh: () => Promise<void>;
  createCategoria: (input: { nome: string; ordem?: number }) => Promise<Categoria>;
  updateCategoria: (id: number, patch: { nome?: string; ordem?: number }) => Promise<void>;
  deleteCategoria: (id: number) => Promise<void>;
  createSubcategoria: (input: { nome: string; id_categoria: number; ordem?: number }) => Promise<Subcategoria>;
  updateSubcategoria: (id: number, patch: { nome?: string; id_categoria?: number; ordem?: number }) => Promise<void>;
  deleteSubcategoria: (id: number) => Promise<void>;
  createProduto: (input: {
    nome: string;
    preco: number;
    id_categoria: number | null;
    id_subcategoria: number | null;
    ocultar_no_pdv?: boolean;
  }) => Promise<ProdutoRow>;
  updateProduto: (
    id: number,
    patch: {
      nome?: string;
      preco?: number;
      id_categoria?: number | null;
      id_subcategoria?: number | null;
      ocultar_no_pdv?: boolean;
    },
  ) => Promise<void>;
  deleteProduto: (id: number) => Promise<void>;
  upsertProductPublication: (productId: number, patch: ZeloMenuProductPublicationInput) => Promise<ZeloMenuProductPublicationRow>;
  replaceProductModifierGroups: (productId: number, groups: ZeloMenuModifierGroupDraft[]) => Promise<ZeloMenuModifierGroupRow[]>;
  uploadProductPublicationImage: (productId: number, file: File, previousUrl?: string | null) => Promise<string>;
  deleteProductPublicationImage: (url: string | null | undefined) => Promise<void>;
}

type CatModalState =
  | { kind: 'categoria'; initial: Categoria | null }
  | { kind: 'subcategoria'; initial: Subcategoria | null; defaultCategoriaId: number | null }
  | { kind: 'produto'; initial: ProdutoRow | null; defaultCategoriaId: number | null; defaultSubcategoriaId: number | null }
  | { kind: 'publication'; product: ProdutoRow }
  | null;

type DeleteState =
  | { kind: 'categoria'; item: Categoria }
  | { kind: 'subcategoria'; item: Subcategoria }
  | { kind: 'produto'; item: ProdutoRow }
  | null;

type ProdutoWithPublication = ProdutoRow & ZeloMenuPublicationProduct;

export const CatalogView = ({
  isAuthenticated,
  authLoading,
  canPublishToMenu,
  loading,
  error,
  categorias,
  subcategorias,
  produtos,
  productPublications,
  productModifierGroups,
  refresh,
  createCategoria,
  updateCategoria,
  deleteCategoria,
  createSubcategoria,
  updateSubcategoria,
  deleteSubcategoria,
  createProduto,
  updateProduto,
  deleteProduto,
  upsertProductPublication,
  replaceProductModifierGroups,
  uploadProductPublicationImage,
  deleteProductPublicationImage,
}: Props) => {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<CatModalState>(null);
  const [del, setDel] = useState<DeleteState>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalized) return produtos;
    return produtos.filter((p) => p.nome.toLowerCase().includes(normalized));
  }, [produtos, normalized]);

  const tree = useMemo(() => buildTree(categorias, subcategorias, filtered), [categorias, subcategorias, filtered]);
  const orphanProducts = useMemo(() => filtered.filter((p) => p.id_categoria == null), [filtered]);
  const visibleProducts = useMemo(
    () => [
      ...tree.flatMap((node) => [
        ...node.produtosDireto,
        ...node.subcategorias.flatMap((subNode) => subNode.produtos),
      ]),
      ...orphanProducts,
    ],
    [orphanProducts, tree],
  );
  const publicationProducts = useMemo(
    () => produtos.map((produto) => withPublication(produto, productPublications)),
    [produtos, productPublications],
  );
  const publicationSummary = useMemo(() => summarizeZeloMenuPublication(publicationProducts), [publicationProducts]);
  const publicationIssues = useMemo(
    () => publicationProducts
      .map((produto) => ({ produto, details: getZeloMenuPublicationStatus(produto) }))
      .filter((item) => item.details.issue !== null)
      .slice(0, 8),
    [publicationProducts],
  );
  const bulk = useCatalogBulkController({
    visibleProducts,
    deleteProduto,
    upsertProductPublication,
  });

  const handleBulkPublish = async () => {
    const result = await bulk.run({ type: 'set-publication', state: 'published' });
    if (result.total === 0) return;
    if (result.failed.length === 0) {
      setBulkFeedback({
        tone: 'success',
        message: `${result.changed} produto${result.changed === 1 ? '' : 's'} publicado${result.changed === 1 ? '' : 's'} no link.`,
      });
      return;
    }
    setBulkFeedback({
      tone: 'error',
      message: `${result.changed} produto${result.changed === 1 ? '' : 's'} publicado${result.changed === 1 ? '' : 's'}, mas ${result.failed.length} não puderam ser atualizados.`,
    });
  };

  const handleBulkDelete = async () => {
    const result = await bulk.run({ type: 'delete' });
    setBulkDeleteConfirm(false);
    if (result.total === 0) return;
    if (result.failed.length === 0) {
      setBulkFeedback({
        tone: 'success',
        message: `${result.changed} produto${result.changed === 1 ? '' : 's'} excluído${result.changed === 1 ? '' : 's'}.`,
      });
      return;
    }
    setBulkFeedback({
      tone: 'error',
      message: `${result.changed} produto${result.changed === 1 ? '' : 's'} excluído${result.changed === 1 ? '' : 's'}, mas ${result.failed.length} falharam.`,
    });
  };

  const toggleCat = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(categorias.map((c) => c.id)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-8">
      <div className="space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <ShoppingBag className="mt-0.5 h-6 w-6 text-[#25D366]" />
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Cardápio</h2>
              <p className="text-sm text-gray-500">
                Cadastre categorias, subcategorias e produtos. A IA usa esses dados para responder clientes no WhatsApp.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void refresh()}
              disabled={authLoading || loading}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
            <button
              onClick={() => setModal({ kind: 'categoria', initial: null })}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              <FolderPlus className="h-4 w-4" /> Nova categoria
            </button>
            <button
              onClick={() => setModal({ kind: 'produto', initial: null, defaultCategoriaId: null, defaultSubcategoriaId: null })}
              className="flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1EBE5D]"
            >
              <Plus className="h-4 w-4" /> Novo produto
            </button>
          </div>
        </header>

        <ZeloMenuPublicationPanel
          totalProdutos={produtos.length}
          summary={publicationSummary}
          issues={publicationIssues}
          onEditProduto={(produto) =>
            setModal({ kind: 'produto', initial: produto, defaultCategoriaId: produto.id_categoria, defaultSubcategoriaId: produto.id_subcategoria })
          }
          onConfigurePublication={(produto) => setModal({ kind: 'publication', product: produto })}
        />

        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-800">{produtos.length} produtos cadastrados</h3>
              <p className="text-xs text-gray-500">
                {categorias.length} categorias · {subcategorias.length} subcategorias
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={expandAll}
                className="text-xs font-semibold text-gray-500 hover:text-gray-800"
              >
                Expandir tudo
              </button>
              <span className="text-gray-300">·</span>
              <button
                onClick={collapseAll}
                className="text-xs font-semibold text-gray-500 hover:text-gray-800"
              >
                Recolher tudo
              </button>
              <span className="text-gray-300">·</span>
              {bulk.selectionMode ? (
                <button
                  onClick={() => {
                    bulk.exitSelection();
                    setBulkFeedback(null);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancelar seleção
                </button>
              ) : (
                <button
                  onClick={() => {
                    bulk.enterSelection();
                    setBulkFeedback(null);
                  }}
                  disabled={visibleProducts.length === 0}
                  className="text-xs font-semibold text-gray-500 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Selecionar
                </button>
              )}
              <div className="ml-2 flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                <Search className="h-4 w-4 text-gray-400" />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setBulkFeedback(null);
                  }}
                  placeholder="Buscar produto..."
                  className="w-full bg-transparent text-sm outline-none md:w-56"
                />
              </div>
            </div>
          </div>

          {bulk.selectionMode && (
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)]/40 p-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <SelectionCheckbox
                  checked={bulk.allVisibleSelected}
                  indeterminate={bulk.hasSelection && !bulk.allVisibleSelected}
                  onChange={bulk.toggleVisible}
                  ariaLabel="Selecionar produtos visíveis"
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-brand-deep)]">
                    {bulk.selectedCount} produto{bulk.selectedCount === 1 ? '' : 's'} selecionado{bulk.selectedCount === 1 ? '' : 's'}
                  </p>
                  <p className="text-xs text-[var(--color-brand-deep)]/80">
                    A seleção acompanha a busca atual desta tela.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void bulk.toggleVisible()}
                  disabled={visibleProducts.length === 0 || bulk.busyAction !== null}
                  className="rounded-lg border border-[var(--color-brand-soft)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulk.allVisibleSelected ? 'Limpar visíveis' : 'Selecionar visíveis'}
                </button>
                {canPublishToMenu && (
                  <button
                    onClick={() => void handleBulkPublish()}
                    disabled={!bulk.hasSelection || bulk.busyAction !== null}
                    className="rounded-lg bg-[#25D366] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1EBE5D] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {bulk.busyAction === 'set-publication' ? 'Publicando...' : 'Publicar no link'}
                  </button>
                )}
                <button
                  onClick={() => setBulkDeleteConfirm(true)}
                  disabled={!bulk.hasSelection || bulk.busyAction !== null}
                  className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulk.busyAction === 'delete' ? 'Excluindo...' : 'Excluir selecionados'}
                </button>
              </div>
            </div>
          )}

          {bulkFeedback && (
            <div className={`mb-4 rounded-xl border p-3 ${
              bulkFeedback.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}>
              <p className="text-xs font-medium">{bulkFeedback.message}</p>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-medium text-red-700">{error}</p>
            </div>
          )}

          {!authLoading && !isAuthenticated && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-800">Faça login para carregar o cardápio.</p>
            </div>
          )}

          {isAuthenticated && !loading && categorias.length === 0 && produtos.length === 0 && !error && (
            <EmptyState
              onCreateCategoria={() => setModal({ kind: 'categoria', initial: null })}
              onCreateProduto={() => setModal({ kind: 'produto', initial: null, defaultCategoriaId: null, defaultSubcategoriaId: null })}
            />
          )}

          {isAuthenticated && (loading || categorias.length > 0 || produtos.length > 0) && (
            <div className="space-y-3">
              {tree.map((node) => (
                <CategoriaCard
                  key={node.categoria.id}
                  node={node}
                  expanded={expanded.has(node.categoria.id)}
                  forceExpanded={Boolean(normalized)}
                  toggle={() => toggleCat(node.categoria.id)}
                  onEditCategoria={() => setModal({ kind: 'categoria', initial: node.categoria })}
                  onDeleteCategoria={() => setDel({ kind: 'categoria', item: node.categoria })}
                  onNewSubcategoria={() =>
                    setModal({ kind: 'subcategoria', initial: null, defaultCategoriaId: node.categoria.id })
                  }
                  onNewProduto={(subId) =>
                    setModal({
                      kind: 'produto',
                      initial: null,
                      defaultCategoriaId: node.categoria.id,
                      defaultSubcategoriaId: subId,
                    })
                  }
                  onEditSubcategoria={(sub) => setModal({ kind: 'subcategoria', initial: sub, defaultCategoriaId: sub.id_categoria })}
                  onDeleteSubcategoria={(sub) => setDel({ kind: 'subcategoria', item: sub })}
                  selectionMode={bulk.selectionMode}
                  selectedIds={bulk.selectedIds}
                  onToggleCategorySelection={(ids) => {
                    setBulkFeedback(null);
                    bulk.toggleMany(ids);
                  }}
                  onToggleSubcategorySelection={(ids) => {
                    setBulkFeedback(null);
                    bulk.toggleMany(ids);
                  }}
                  onToggleProdutoSelection={(id) => {
                    setBulkFeedback(null);
                    bulk.toggle(id);
                  }}
                  onEditProduto={(p) =>
                    setModal({ kind: 'produto', initial: p, defaultCategoriaId: p.id_categoria, defaultSubcategoriaId: p.id_subcategoria })
                  }
                  onDeleteProduto={(p) => setDel({ kind: 'produto', item: p })}
                  productPublications={productPublications}
                  onConfigurePublication={(p) => setModal({ kind: 'publication', product: p })}
                />
              ))}

              {orphanProducts.length > 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    {bulk.selectionMode && (
                      <SelectionCheckbox
                        checked={getSelectionState(orphanProducts.map((product) => product.id), bulk.selectedIds) === 'all'}
                        indeterminate={getSelectionState(orphanProducts.map((product) => product.id), bulk.selectedIds) === 'some'}
                        onChange={() => {
                          setBulkFeedback(null);
                          bulk.toggleMany(orphanProducts.map((product) => product.id));
                        }}
                        ariaLabel="Selecionar produtos sem categoria"
                      />
                    )}
                    <p className="text-xs font-semibold text-gray-500">Sem categoria ({orphanProducts.length})</p>
                  </div>
                  <div className="space-y-2">
                    {orphanProducts.map((p) => (
                      <ProdutoRowItem
                        key={p.id}
                        produto={p}
                        selectionMode={bulk.selectionMode}
                        selected={bulk.isSelected(p.id)}
                        onToggleSelected={() => {
                          setBulkFeedback(null);
                          bulk.toggle(p.id);
                        }}
                        onEdit={() =>
                          setModal({ kind: 'produto', initial: p, defaultCategoriaId: null, defaultSubcategoriaId: null })
                        }
                        onDelete={() => setDel({ kind: 'produto', item: p })}
                        publication={productPublications[p.id] ?? null}
                        onConfigurePublication={() => setModal({ kind: 'publication', product: p })}
                      />
                    ))}
                  </div>
                </div>
              )}

              {normalized && filtered.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">
                  Nenhum produto encontrado para "{query}".
                </div>
              )}
            </div>
          )}

          <p className="mt-6 border-t border-gray-100 pt-4 text-[12px] text-gray-500">
            Para imagens próprias do produto, acesse o{' '}
            <a
              href="https://zelopdv.com.br"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-[#0B7A3B] hover:underline"
            >
              ZeloPDV <ExternalLink className="h-3 w-3" />
            </a>
            .
          </p>
        </section>
      </div>

      {/* Modals */}
      <CategoriaModal
        open={modal?.kind === 'categoria'}
        initial={modal?.kind === 'categoria' ? modal.initial : null}
        onClose={() => setModal(null)}
        onSubmit={async (input) => {
          if (modal?.kind === 'categoria' && modal.initial) {
            await updateCategoria(modal.initial.id, input);
          } else {
            await createCategoria(input);
          }
        }}
      />

      <SubcategoriaModal
        open={modal?.kind === 'subcategoria'}
        initial={modal?.kind === 'subcategoria' ? modal.initial : null}
        defaultCategoriaId={modal?.kind === 'subcategoria' ? modal.defaultCategoriaId : null}
        categorias={categorias}
        onClose={() => setModal(null)}
        onSubmit={async (input) => {
          if (modal?.kind === 'subcategoria' && modal.initial) {
            await updateSubcategoria(modal.initial.id, input);
          } else {
            await createSubcategoria(input);
          }
        }}
      />

      <ProductModal
        open={modal?.kind === 'produto'}
        initial={modal?.kind === 'produto' ? modal.initial : null}
        defaultCategoriaId={modal?.kind === 'produto' ? modal.defaultCategoriaId : null}
        defaultSubcategoriaId={modal?.kind === 'produto' ? modal.defaultSubcategoriaId : null}
        categorias={categorias}
        subcategorias={subcategorias}
        onClose={() => setModal(null)}
        onSubmit={async (input) => {
          if (modal?.kind === 'produto' && modal.initial) {
            await updateProduto(modal.initial.id, input);
          } else {
            await createProduto(input);
          }
        }}
      />

      <ProductPublicationModal
        open={modal?.kind === 'publication'}
        product={modal?.kind === 'publication' ? modal.product : null}
        initial={modal?.kind === 'publication' ? productPublications[modal.product.id] ?? null : null}
        modifierGroups={modal?.kind === 'publication' ? productModifierGroups[modal.product.id] ?? [] : []}
        uploadImage={uploadProductPublicationImage}
        onClose={() => setModal(null)}
        onSubmit={async (input, groups) => {
          if (modal?.kind !== 'publication') return;
          const previousPhotoUrl = productPublications[modal.product.id]?.foto_url ?? null;
          const nextPhotoUrl = Object.prototype.hasOwnProperty.call(input, 'foto_url')
            ? input.foto_url ?? null
            : previousPhotoUrl;
          await upsertProductPublication(modal.product.id, input);
          await replaceProductModifierGroups(modal.product.id, groups);
          if (previousPhotoUrl && previousPhotoUrl !== nextPhotoUrl) {
            deleteProductPublicationImage(previousPhotoUrl).catch((error) => {
              console.warn('[Catalog] Failed to remove previous owned publication image:', error);
            });
          }
        }}
      />

      <ConfirmDelete
        open={del !== null}
        title={
          del?.kind === 'produto'
            ? 'Excluir produto?'
            : del?.kind === 'subcategoria'
              ? 'Excluir subcategoria?'
              : 'Excluir categoria?'
        }
        message={
          del?.kind === 'produto'
            ? `O produto "${del.item.nome}" será removido permanentemente.`
            : del?.kind === 'subcategoria'
              ? `A subcategoria "${del.item.nome}" será removida. Produtos ligados a ela ficarão sem subcategoria.`
              : del?.kind === 'categoria'
                ? `A categoria "${del.item.nome}" e suas subcategorias serão removidas. Produtos ficarão sem categoria.`
                : ''
        }
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          if (del.kind === 'categoria') await deleteCategoria(del.item.id);
          else if (del.kind === 'subcategoria') await deleteSubcategoria(del.item.id);
          else if (del.kind === 'produto') await deleteProduto(del.item.id);
        }}
      />

      <ConfirmDelete
        open={bulkDeleteConfirm}
        title="Excluir produtos selecionados?"
        message={`Excluir ${bulk.selectedCount} produto${bulk.selectedCount === 1 ? '' : 's'}? Esta ação não pode ser desfeita.`}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
      />
    </div>
  );
};

// ---------- Sub components ----------

type TreeNode = {
  categoria: Categoria;
  produtosDireto: ProdutoRow[];
  subcategorias: Array<{ subcategoria: Subcategoria; produtos: ProdutoRow[] }>;
};

function buildTree(categorias: Categoria[], subcategorias: Subcategoria[], produtos: ProdutoRow[]): TreeNode[] {
  return categorias.map((categoria) => {
    const subs = subcategorias.filter((s) => s.id_categoria === categoria.id);
    const produtosByCategoria = produtos.filter((p) => p.id_categoria === categoria.id);
    const produtosDireto = produtosByCategoria.filter((p) => p.id_subcategoria == null);
    const subNodes = subs.map((sub) => ({
      subcategoria: sub,
      produtos: produtosByCategoria.filter((p) => p.id_subcategoria === sub.id),
    }));
    return { categoria, produtosDireto, subcategorias: subNodes };
  });
}

function withPublication(
  produto: ProdutoRow,
  productPublications: Record<number, ZeloMenuProductPublicationRow>,
): ProdutoWithPublication {
  return {
    ...produto,
    publication: productPublications[produto.id] ?? null,
  };
}

type CategoriaCardProps = {
  node: TreeNode;
  expanded: boolean;
  forceExpanded: boolean;
  toggle: () => void;
  onEditCategoria: () => void;
  onDeleteCategoria: () => void;
  onNewSubcategoria: () => void;
  onNewProduto: (subId: number | null) => void;
  onEditSubcategoria: (sub: Subcategoria) => void;
  onDeleteSubcategoria: (sub: Subcategoria) => void;
  selectionMode: boolean;
  selectedIds: ReadonlySet<number>;
  onToggleCategorySelection: (ids: number[]) => void;
  onToggleSubcategorySelection: (ids: number[]) => void;
  onToggleProdutoSelection: (id: number) => void;
  onEditProduto: (p: ProdutoRow) => void;
  onDeleteProduto: (p: ProdutoRow) => void;
  productPublications: Record<number, ZeloMenuProductPublicationRow>;
  onConfigurePublication: (p: ProdutoRow) => void;
};

const CategoriaCard: React.FC<CategoriaCardProps> = ({
  node,
  expanded,
  forceExpanded,
  toggle,
  onEditCategoria,
  onDeleteCategoria,
  onNewSubcategoria,
  onNewProduto,
  onEditSubcategoria,
  onDeleteSubcategoria,
  selectionMode,
  selectedIds,
  onToggleCategorySelection,
  onToggleSubcategorySelection,
  onToggleProdutoSelection,
  onEditProduto,
  onDeleteProduto,
  productPublications,
  onConfigurePublication,
}) => {
  const isOpen = expanded || forceExpanded;
  const totalProdutos = node.produtosDireto.length + node.subcategorias.reduce((acc, s) => acc + s.produtos.length, 0);
  const categoryIds = getCategoryProductIds(node);
  const categorySelectionState = getSelectionState(categoryIds, selectedIds);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
      <div className="flex items-center gap-2 bg-gray-50 px-3 py-3">
        {selectionMode && totalProdutos > 0 && (
          <SelectionCheckbox
            checked={categorySelectionState === 'all'}
            indeterminate={categorySelectionState === 'some'}
            onChange={() => onToggleCategorySelection(categoryIds)}
            ariaLabel={`Selecionar categoria ${node.categoria.nome}`}
          />
        )}
        <button
          onClick={toggle}
          className="rounded-lg p-1 text-gray-500 hover:bg-white"
          aria-label={isOpen ? 'Recolher' : 'Expandir'}
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <button onClick={toggle} className="flex-1 text-left">
          <span className="text-sm font-bold text-gray-800">{node.categoria.nome}</span>
          <span className="ml-2 text-xs text-gray-500">
            {totalProdutos} {totalProdutos === 1 ? 'produto' : 'produtos'}
            {node.subcategorias.length > 0 ? ` · ${node.subcategorias.length} subcategoria${node.subcategorias.length === 1 ? '' : 's'}` : ''}
          </span>
        </button>

        <div className="flex items-center gap-1">
          <IconBtn title="Nova subcategoria" onClick={onNewSubcategoria}>
            <FolderPlus className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Novo produto nesta categoria" onClick={() => onNewProduto(null)}>
            <Plus className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Editar categoria" onClick={onEditCategoria}>
            <Pencil className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Excluir categoria" onClick={onDeleteCategoria} destructive>
            <Trash2 className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>

      {isOpen && (
        <div className="divide-y divide-gray-100">
          {node.produtosDireto.map((p) => (
            <div key={p.id} className="px-4 py-2">
              <ProdutoRowItem
                produto={p}
                selectionMode={selectionMode}
                selected={selectedIds.has(p.id)}
                onToggleSelected={() => onToggleProdutoSelection(p.id)}
                publication={productPublications[p.id] ?? null}
                onEdit={() => onEditProduto(p)}
                onDelete={() => onDeleteProduto(p)}
                onConfigurePublication={() => onConfigurePublication(p)}
              />
            </div>
          ))}

          {node.subcategorias.map(({ subcategoria, produtos }) => (
            <div key={subcategoria.id} className="px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                {selectionMode && produtos.length > 0 && (
                  <SelectionCheckbox
                    checked={getSelectionState(produtos.map((p) => p.id), selectedIds) === 'all'}
                    indeterminate={getSelectionState(produtos.map((p) => p.id), selectedIds) === 'some'}
                    onChange={() => onToggleSubcategorySelection(produtos.map((p) => p.id))}
                    ariaLabel={`Selecionar subcategoria ${subcategoria.nome}`}
                  />
                )}
                <span className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">
                  {subcategoria.nome}
                </span>
                <span className="text-[11px] text-gray-400">
                  {produtos.length} {produtos.length === 1 ? 'produto' : 'produtos'}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <IconBtn title="Novo produto nesta subcategoria" onClick={() => onNewProduto(subcategoria.id)}>
                    <Plus className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn title="Editar subcategoria" onClick={() => onEditSubcategoria(subcategoria)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn title="Excluir subcategoria" onClick={() => onDeleteSubcategoria(subcategoria)} destructive>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconBtn>
                </div>
              </div>
              <div className="space-y-1.5">
                {produtos.map((p) => (
                  <ProdutoRowItem
                    key={p.id}
                    produto={p}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(p.id)}
                    onToggleSelected={() => onToggleProdutoSelection(p.id)}
                    publication={productPublications[p.id] ?? null}
                    onEdit={() => onEditProduto(p)}
                    onDelete={() => onDeleteProduto(p)}
                    onConfigurePublication={() => onConfigurePublication(p)}
                  />
                ))}
                {produtos.length === 0 && (
                  <p className="py-1 text-[12px] italic text-gray-400">
                    Nenhum produto aqui ainda.
                  </p>
                )}
              </div>
            </div>
          ))}

          {node.produtosDireto.length === 0 && node.subcategorias.length === 0 && (
            <div className="px-4 py-5 text-center text-xs text-gray-500">
              Nenhum produto nesta categoria.{' '}
              <button
                onClick={() => onNewProduto(null)}
                className="font-semibold text-[#0B7A3B] hover:underline"
              >
                Adicionar produto
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

type ProdutoRowItemProps = {
  produto: ProdutoRow;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  publication?: ZeloMenuProductPublicationRow | null;
  onEdit: () => void;
  onDelete: () => void;
  onConfigurePublication: () => void;
};

const ProdutoRowItem: React.FC<ProdutoRowItemProps> = ({
  produto,
  selectionMode = false,
  selected = false,
  onToggleSelected,
  publication,
  onEdit,
  onDelete,
  onConfigurePublication,
}) => {
  const publicationStatus = getZeloMenuPublicationStatus({ ...produto, publication: publication ?? null });

  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
      {selectionMode && (
        <SelectionCheckbox
          checked={selected}
          onChange={() => onToggleSelected?.()}
          ariaLabel={`Selecionar produto ${produto.nome}`}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-800">{produto.nome}</span>
          {produto.ocultar_no_pdv && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
              Oculto
            </span>
          )}
          <PublicationStatusPill status={publicationStatus.status} />
        </div>
        {(publication?.nome_publico || publication?.descricao_publica) && (
          <p className="mt-0.5 truncate text-[11.5px] text-gray-500">
            {publication.nome_publico || produto.nome}
            {publication.descricao_publica ? ` · ${publication.descricao_publica}` : ''}
          </p>
        )}
      </div>

      <span className="font-mono text-sm text-gray-700">R$ {produto.preco.toFixed(2)}</span>

      {produto.controlar_estoque && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
            produto.estoque_atual === 0
              ? 'bg-red-100 text-red-700'
              : produto.estoque_atual <= 5
                ? 'bg-amber-100 text-amber-700'
                : 'bg-green-100 text-green-700'
          }`}
        >
          {produto.estoque_atual === 0 ? 'Sem estoque' : `${produto.estoque_atual} em estoque`}
        </span>
      )}

      {!selectionMode && (
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <IconBtn title="Publicação no ZeloMenu" onClick={onConfigurePublication}>
            <Globe2 className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn title="Editar produto" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn title="Excluir produto" onClick={onDelete} destructive>
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      )}
    </div>
  );
};

type ZeloMenuPublicationPanelProps = {
  totalProdutos: number;
  summary: ReturnType<typeof summarizeZeloMenuPublication>;
  issues: Array<{ produto: ProdutoWithPublication; details: ReturnType<typeof getZeloMenuPublicationStatus> }>;
  onEditProduto: (produto: ProdutoRow) => void;
  onConfigurePublication: (produto: ProdutoRow) => void;
};

const ZeloMenuPublicationPanel: React.FC<ZeloMenuPublicationPanelProps> = ({
  totalProdutos,
  summary,
  issues,
  onEditProduto,
  onConfigurePublication,
}) => {
  const readyPercent = totalProdutos > 0 ? Math.round((summary.published / totalProdutos) * 100) : 0;

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
            <Globe2 className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-[var(--color-ink)]">Publicação no ZeloMenu</h3>
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--color-ink-muted)]">
              Produtos prontos para o link, itens inativos e ajustes que deixam o cardápio mais claro para o cliente.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-5">
        <PublicationMetric label="Publicados" value={summary.published} detail={`${readyPercent}% do cardápio`} tone="published" />
        <PublicationMetric label="Não publicados" value={summary.unpublished} detail="Fora do link" tone="unpublished" />
        <PublicationMetric label="Pausados" value={summary.paused} detail="Ocultos por agora" tone="paused" />
        <PublicationMetric label="Sem estoque" value={summary.outOfStock} detail="Bloqueados pelo estoque" tone="out_of_stock" />
        <PublicationMetric label="Sem categoria" value={summary.missingCategory} detail="Precisam de organização" tone="missing_category" />
      </div>

      {issues.length > 0 ? (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-[var(--color-ink)]">Ajustes pendentes</p>
              <p className="text-[12px] text-[var(--color-ink-muted)]">
                Itens que ainda reduzem a clareza do cardápio no link.
              </p>
            </div>
            {summary.attention > issues.length && (
              <span className="shrink-0 text-[12px] font-medium text-[var(--color-ink-faint)]">
                +{summary.attention - issues.length} restantes
              </span>
            )}
          </div>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {issues.map(({ produto, details }) => (
              <button
                key={produto.id}
                type="button"
                onClick={() => {
                  if (details.status === 'unpublished' || details.status === 'paused') {
                    onConfigurePublication(produto);
                  } else {
                    onEditProduto(produto);
                  }
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
              >
                <PublicationStatusPill status={details.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--color-ink)]">{produto.nome}</p>
                  <p className="text-[12px] text-[var(--color-ink-muted)]">{details.description}</p>
                </div>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)] px-3 py-2.5 text-[13px] text-[var(--color-brand-deep)]">
          <CircleCheck className="h-4 w-4 shrink-0" />
          Produtos ativos estão prontos para aparecer no link do cardápio.
        </div>
      )}
    </section>
  );
};

function PublicationMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: ZeloMenuPublicationStatus;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-[var(--color-ink-soft)]">{label}</span>
        <PublicationStatusIcon status={tone} />
      </div>
      <p className="text-2xl font-bold tabular-nums text-[var(--color-ink)]">{value}</p>
      <p className="mt-0.5 text-[11.5px] text-[var(--color-ink-muted)]">{detail}</p>
    </div>
  );
}

function PublicationStatusPill({ status }: { status: ZeloMenuPublicationStatus }) {
  const details = publicationTone(status);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold ${details.className}`}>
      <PublicationStatusIcon status={status} />
      {details.label}
    </span>
  );
}

function PublicationStatusIcon({ status }: { status: ZeloMenuPublicationStatus }) {
  if (status === 'published') return <CircleCheck className="h-3.5 w-3.5" />;
  if (status === 'unpublished') return <Globe2 className="h-3.5 w-3.5" />;
  if (status === 'paused') return <PauseCircle className="h-3.5 w-3.5" />;
  if (status === 'hidden') return <EyeOff className="h-3.5 w-3.5" />;
  return <AlertCircle className="h-3.5 w-3.5" />;
}

function publicationTone(status: ZeloMenuPublicationStatus): { label: string; className: string } {
  if (status === 'published') {
    return { label: 'Publicado', className: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]' };
  }
  if (status === 'unpublished') {
    return { label: 'Não publicado', className: 'bg-gray-100 text-gray-600' };
  }
  if (status === 'paused') {
    return { label: 'Pausado', className: 'bg-blue-50 text-blue-700' };
  }
  if (status === 'hidden') {
    return { label: 'Inativo', className: 'bg-slate-100 text-slate-700' };
  }
  if (status === 'out_of_stock') {
    return { label: 'Sem estoque', className: 'bg-red-50 text-red-700' };
  }
  return { label: 'Sem categoria', className: 'bg-amber-50 text-amber-700' };
}

function IconBtn({
  title,
  onClick,
  destructive,
  children,
}: {
  title: string;
  onClick: () => void;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-lg p-1.5 transition-colors ${
        destructive
          ? 'text-gray-400 hover:bg-red-50 hover:text-red-600'
          : 'text-gray-500 hover:bg-white hover:text-gray-800'
      }`}
    >
      {children}
    </button>
  );
}

type SelectionState = 'none' | 'some' | 'all';

function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={ariaLabel}
      className="h-4 w-4 rounded border-gray-300 text-[#25D366] focus:ring-[#25D366]"
    />
  );
}

function EmptyState({
  onCreateCategoria,
  onCreateProduto,
}: {
  onCreateCategoria: () => void;
  onCreateProduto: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#25D366]/10">
        <ShoppingBag className="h-8 w-8 text-[#25D366]" />
      </div>
      <div>
        <h3 className="text-base font-bold text-gray-800">Comece cadastrando seu cardápio</h3>
        <p className="mt-1 text-sm text-gray-500">
          Categorias, subcategorias e produtos. Tudo em um só lugar.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCreateCategoria}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <FolderPlus className="h-4 w-4" /> Criar categoria
        </button>
        <button
          onClick={onCreateProduto}
          className="flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1EBE5D]"
        >
          <Plus className="h-4 w-4" /> Criar produto
        </button>
      </div>
    </div>
  );
}

function getCategoryProductIds(node: TreeNode): number[] {
  return [
    ...node.produtosDireto.map((produto) => produto.id),
    ...node.subcategorias.flatMap((subNode) => subNode.produtos.map((produto) => produto.id)),
  ];
}

function getSelectionState(productIds: number[], selectedIds: ReadonlySet<number>): SelectionState {
  if (productIds.length === 0) return 'none';
  let selectedCount = 0;
  for (const id of productIds) {
    if (selectedIds.has(id)) selectedCount += 1;
  }
  if (selectedCount === 0) return 'none';
  if (selectedCount === productIds.length) return 'all';
  return 'some';
}
