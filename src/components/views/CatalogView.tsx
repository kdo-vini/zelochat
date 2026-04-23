import React, { useMemo, useState } from 'react';
import { RefreshCw, Search, ShoppingBag } from 'lucide-react';
import type { Produto } from '../../services/zeloApi';
import type { ZeloState } from '../../types';

interface Props {
  state: ZeloState;
  isAuthenticated: boolean;
  authLoading: boolean;
  produtosLoading: boolean;
  produtosError: string | null;
  produtosPdv: Produto[];
  refreshProdutos: () => Promise<void>;
}

export const CatalogView = ({
  state,
  isAuthenticated,
  authLoading,
  produtosLoading,
  produtosError,
  produtosPdv,
  refreshProdutos,
}: Props) => {
  const [query, setQuery] = useState('');

  const produtosFiltrados = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return produtosPdv;
    return produtosPdv.filter((produto) => produto.nome.toLowerCase().includes(normalized));
  }, [produtosPdv, query]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-8">
      <div className="space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShoppingBag className="h-6 w-6 text-[#00a884]" />
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Cardápio do PDV</h2>
              <p className="text-sm text-gray-500">
                Esta tela usa somente os produtos reais vindos da API do Zelo PDV.
              </p>
            </div>
          </div>

          <button
            onClick={() => void refreshProdutos()}
            disabled={authLoading || produtosLoading}
            className="flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2 text-sm font-bold text-white transition-colors disabled:bg-gray-300"
          >
            <RefreshCw className={`h-4 w-4 ${produtosLoading ? 'animate-spin' : ''}`} />
            {produtosLoading ? 'Atualizando...' : 'Atualizar'}
          </button>
        </header>

        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-800">Produtos sincronizados</h3>
              <p className="text-xs text-gray-500">
                {state.products.length} itens normalizados para IA e {produtosPdv.length} registros brutos no PDV
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
              <Search className="h-4 w-4 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar produto..."
                className="w-full bg-transparent text-sm outline-none md:w-64"
              />
            </div>
          </div>

          {produtosError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-medium text-red-700">{produtosError}</p>
            </div>
          )}

          {!authLoading && !isAuthenticated && !produtosLoading && !produtosError && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-800">
                Faça login no Supabase em Perfil para carregar os produtos do PDV.
              </p>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-gray-100">
            {produtosFiltrados.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">
                {produtosLoading ? 'Carregando cardápio...' : 'Nenhum produto encontrado.'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {produtosFiltrados.map((produto) => (
                  <div
                    key={produto.id}
                    className="flex items-start justify-between gap-4 bg-white p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-800">{produto.nome}</p>
                      <p className="text-[11px] text-gray-500">
                        ID: <span className="font-mono">{produto.id}</span>
                        {produto.id_categoria ? (
                          <>
                            {' '}• Categoria: <span className="font-mono">{produto.id_categoria}</span>
                          </>
                        ) : null}
                      </p>
                      <span
                        className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          produto.ocultar_no_pdv
                            ? 'bg-gray-100 text-gray-500'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {produto.ocultar_no_pdv ? 'Oculto no PDV' : 'Visível no PDV'}
                      </span>
                    </div>

                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase text-gray-400">Preço</p>
                      <p className="text-sm font-mono text-gray-800">
                        R$ {Number(produto.preco).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
