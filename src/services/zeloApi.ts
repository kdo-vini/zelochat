import type { Product } from '../types';

export type Produto = {
  id: string;
  nome: string;
  preco: number | string;
  id_categoria: string | null;
  ocultar_no_pdv: boolean | null;
};

export async function getProdutos(params: {
  token: string;
  onlyVisible?: boolean;
}): Promise<Produto[]> {
  // Importante: o host sem "www" redireciona (307) para "www".
  // Browsers NÃO seguem redirects em preflight CORS (OPTIONS), causando "Failed to fetch".
  // Então chamamos direto o destino final.
  const url = new URL('https://www.zelopdv.com.br/api/produtos');
  url.searchParams.set('onlyVisible', String(params.onlyVisible ?? true));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.token}`,
      Accept: 'application/json',
    },
  });

  const body = await res.json().catch(() => ({} as any));

  if (!res.ok) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }

  return Array.isArray(body.data) ? body.data : [];
}

export function normalizePreco(preco: number | string): number {
  if (typeof preco === 'number') return preco;
  const n = Number(preco);
  return Number.isFinite(n) ? n : 0;
}

export function inferCategoria(nome: string): Product['category'] {
  const normalized = nome.toLowerCase();

  if (
    normalized.includes('coca') ||
    normalized.includes('guaran') ||
    normalized.includes('suco') ||
    normalized.includes('refrigerante') ||
    normalized.includes('água') ||
    normalized.includes('agua')
  ) {
    return 'bebida';
  }

  if (
    normalized.includes('brigadeiro') ||
    normalized.includes('bolo') ||
    normalized.includes('doce') ||
    normalized.includes('torta') ||
    normalized.includes('churro')
  ) {
    return 'doce';
  }

  return 'salgado';
}

export function mapProdutoToProduct(produto: Produto): Product {
  return {
    id: produto.id,
    name: produto.nome,
    price: normalizePreco(produto.preco),
    available: !produto.ocultar_no_pdv,
    category: inferCategoria(produto.nome),
  };
}
