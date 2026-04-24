import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';

export type Categoria = {
  id: number;
  nome: string;
  ordem: number;
};

export type Subcategoria = {
  id: number;
  id_categoria: number;
  nome: string;
  ordem: number;
};

export type ProdutoRow = {
  id: number;
  nome: string;
  preco: number;
  id_categoria: number | null;
  id_subcategoria: number | null;
  controlar_estoque: boolean;
  estoque_atual: number;
  eh_item_por_unidade: boolean;
  ocultar_no_pdv: boolean;
};

export type ProdutoInput = {
  nome: string;
  preco: number;
  id_categoria: number | null;
  id_subcategoria: number | null;
  controlar_estoque?: boolean;
  estoque_atual?: number;
  eh_item_por_unidade?: boolean;
  ocultar_no_pdv?: boolean;
};

export type CategoriaInput = { nome: string; ordem?: number };
export type SubcategoriaInput = { nome: string; id_categoria: number; ordem?: number };

type CatalogState = {
  categorias: Categoria[];
  subcategorias: Subcategoria[];
  produtos: ProdutoRow[];
};

const EMPTY: CatalogState = { categorias: [], subcategorias: [], produtos: [] };

export function useCatalog(session: Session | null) {
  const [data, setData] = useState<CatalogState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user?.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setData(EMPTY);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [catsRes, subsRes, prodsRes] = await Promise.all([
        supabase.from('categorias').select('id, nome, ordem').order('ordem').order('nome'),
        supabase.from('subcategorias').select('id, id_categoria, nome, ordem').order('ordem').order('nome'),
        supabase
          .from('produtos')
          .select('id, nome, preco, id_categoria, id_subcategoria, controlar_estoque, estoque_atual, eh_item_por_unidade, ocultar_no_pdv')
          .order('nome'),
      ]);
      if (catsRes.error) throw catsRes.error;
      if (subsRes.error) throw subsRes.error;
      if (prodsRes.error) throw prodsRes.error;
      setData({
        categorias: (catsRes.data ?? []) as Categoria[],
        subcategorias: (subsRes.data ?? []).map((r: any) => ({
          id: Number(r.id),
          id_categoria: Number(r.id_categoria),
          nome: r.nome,
          ordem: r.ordem ?? 0,
        })),
        produtos: (prodsRes.data ?? []).map((r: any) => ({
          id: Number(r.id),
          nome: r.nome,
          preco: Number(r.preco ?? 0),
          id_categoria: r.id_categoria == null ? null : Number(r.id_categoria),
          id_subcategoria: r.id_subcategoria == null ? null : Number(r.id_subcategoria),
          controlar_estoque: !!r.controlar_estoque,
          estoque_atual: Number(r.estoque_atual ?? 0),
          eh_item_por_unidade: !!r.eh_item_por_unidade,
          ocultar_no_pdv: !!r.ocultar_no_pdv,
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar o catálogo.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Categoria CRUD
  const createCategoria = useCallback(async (input: CategoriaInput): Promise<Categoria> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const { data: row, error: dbError } = await supabase
      .from('categorias')
      .insert({ id_usuario: userId, nome: input.nome.trim(), ordem: input.ordem ?? 0 })
      .select('id, nome, ordem')
      .single();
    if (dbError) throw dbError;
    const created = row as Categoria;
    setData((prev) => ({ ...prev, categorias: [...prev.categorias, created].sort(sortByOrdemNome) }));
    return created;
  }, [userId]);

  const updateCategoria = useCallback(async (id: number, patch: Partial<CategoriaInput>): Promise<void> => {
    const update: Record<string, unknown> = {};
    if (patch.nome !== undefined) update.nome = patch.nome.trim();
    if (patch.ordem !== undefined) update.ordem = patch.ordem;
    const { error: dbError } = await supabase.from('categorias').update(update).eq('id', id);
    if (dbError) throw dbError;
    setData((prev) => ({
      ...prev,
      categorias: prev.categorias.map((c) => (c.id === id ? { ...c, ...patch, nome: patch.nome?.trim() ?? c.nome } : c)).sort(sortByOrdemNome),
    }));
  }, []);

  const deleteCategoria = useCallback(async (id: number): Promise<void> => {
    const { error: dbError } = await supabase.from('categorias').delete().eq('id', id);
    if (dbError) throw dbError;
    setData((prev) => ({
      ...prev,
      categorias: prev.categorias.filter((c) => c.id !== id),
      subcategorias: prev.subcategorias.filter((s) => s.id_categoria !== id),
      produtos: prev.produtos.map((p) => (p.id_categoria === id ? { ...p, id_categoria: null, id_subcategoria: null } : p)),
    }));
  }, []);

  // Subcategoria CRUD
  const createSubcategoria = useCallback(async (input: SubcategoriaInput): Promise<Subcategoria> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const { data: row, error: dbError } = await supabase
      .from('subcategorias')
      .insert({
        id_usuario: userId,
        id_categoria: input.id_categoria,
        nome: input.nome.trim(),
        ordem: input.ordem ?? 0,
      })
      .select('id, id_categoria, nome, ordem')
      .single();
    if (dbError) throw dbError;
    const created: Subcategoria = {
      id: Number((row as any).id),
      id_categoria: Number((row as any).id_categoria),
      nome: (row as any).nome,
      ordem: (row as any).ordem ?? 0,
    };
    setData((prev) => ({ ...prev, subcategorias: [...prev.subcategorias, created].sort(sortByOrdemNome) }));
    return created;
  }, [userId]);

  const updateSubcategoria = useCallback(async (id: number, patch: Partial<SubcategoriaInput>): Promise<void> => {
    const update: Record<string, unknown> = {};
    if (patch.nome !== undefined) update.nome = patch.nome.trim();
    if (patch.ordem !== undefined) update.ordem = patch.ordem;
    if (patch.id_categoria !== undefined) update.id_categoria = patch.id_categoria;
    const { error: dbError } = await supabase.from('subcategorias').update(update).eq('id', id);
    if (dbError) throw dbError;
    setData((prev) => ({
      ...prev,
      subcategorias: prev.subcategorias
        .map((s) => (s.id === id ? { ...s, ...patch, nome: patch.nome?.trim() ?? s.nome } : s))
        .sort(sortByOrdemNome),
    }));
  }, []);

  const deleteSubcategoria = useCallback(async (id: number): Promise<void> => {
    const { error: dbError } = await supabase.from('subcategorias').delete().eq('id', id);
    if (dbError) throw dbError;
    setData((prev) => ({
      ...prev,
      subcategorias: prev.subcategorias.filter((s) => s.id !== id),
      produtos: prev.produtos.map((p) => (p.id_subcategoria === id ? { ...p, id_subcategoria: null } : p)),
    }));
  }, []);

  // Produto CRUD
  const createProduto = useCallback(async (input: ProdutoInput): Promise<ProdutoRow> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const payload = {
      id_usuario: userId,
      nome: input.nome.trim(),
      preco: input.preco,
      id_categoria: input.id_categoria,
      id_subcategoria: input.id_subcategoria,
      controlar_estoque: input.controlar_estoque ?? false,
      estoque_atual: input.estoque_atual ?? 0,
      eh_item_por_unidade: input.eh_item_por_unidade ?? false,
      ocultar_no_pdv: input.ocultar_no_pdv ?? false,
    };
    const { data: row, error: dbError } = await supabase
      .from('produtos')
      .insert(payload)
      .select('id, nome, preco, id_categoria, id_subcategoria, controlar_estoque, estoque_atual, eh_item_por_unidade, ocultar_no_pdv')
      .single();
    if (dbError) throw dbError;
    const created: ProdutoRow = normalizeProdutoRow(row);
    setData((prev) => ({ ...prev, produtos: [...prev.produtos, created].sort((a, b) => a.nome.localeCompare(b.nome)) }));
    return created;
  }, [userId]);

  const updateProduto = useCallback(async (id: number, patch: Partial<ProdutoInput>): Promise<void> => {
    const update: Record<string, unknown> = {};
    if (patch.nome !== undefined) update.nome = patch.nome.trim();
    if (patch.preco !== undefined) update.preco = patch.preco;
    if (patch.id_categoria !== undefined) update.id_categoria = patch.id_categoria;
    if (patch.id_subcategoria !== undefined) update.id_subcategoria = patch.id_subcategoria;
    if (patch.controlar_estoque !== undefined) update.controlar_estoque = patch.controlar_estoque;
    if (patch.estoque_atual !== undefined) update.estoque_atual = patch.estoque_atual;
    if (patch.eh_item_por_unidade !== undefined) update.eh_item_por_unidade = patch.eh_item_por_unidade;
    if (patch.ocultar_no_pdv !== undefined) update.ocultar_no_pdv = patch.ocultar_no_pdv;
    const { error: dbError } = await supabase.from('produtos').update(update).eq('id', id);
    if (dbError) throw dbError;
    setData((prev) => ({
      ...prev,
      produtos: prev.produtos
        .map((p) => (p.id === id ? { ...p, ...patch, nome: patch.nome?.trim() ?? p.nome } as ProdutoRow : p))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    }));
  }, []);

  const deleteProduto = useCallback(async (id: number): Promise<void> => {
    const { error: dbError } = await supabase.from('produtos').delete().eq('id', id);
    if (dbError) throw dbError;
    setData((prev) => ({ ...prev, produtos: prev.produtos.filter((p) => p.id !== id) }));
  }, []);

  return {
    ...data,
    loading,
    error,
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
  };
}

function sortByOrdemNome<T extends { ordem: number; nome: string }>(a: T, b: T): number {
  if (a.ordem !== b.ordem) return a.ordem - b.ordem;
  return a.nome.localeCompare(b.nome);
}

function normalizeProdutoRow(row: any): ProdutoRow {
  return {
    id: Number(row.id),
    nome: row.nome,
    preco: Number(row.preco ?? 0),
    id_categoria: row.id_categoria == null ? null : Number(row.id_categoria),
    id_subcategoria: row.id_subcategoria == null ? null : Number(row.id_subcategoria),
    controlar_estoque: !!row.controlar_estoque,
    estoque_atual: Number(row.estoque_atual ?? 0),
    eh_item_por_unidade: !!row.eh_item_por_unidade,
    ocultar_no_pdv: !!row.ocultar_no_pdv,
  };
}
