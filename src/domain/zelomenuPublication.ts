export type ZeloMenuPublicationProduct = {
  id: number;
  nome: string;
  id_categoria: number | null;
  controlar_estoque: boolean;
  estoque_atual: number;
  ocultar_no_pdv: boolean;
};

export type ZeloMenuPublicationStatus =
  | 'published'
  | 'hidden'
  | 'out_of_stock'
  | 'missing_category';

export type ZeloMenuPublicationIssue = Exclude<ZeloMenuPublicationStatus, 'published'>;

export type ZeloMenuPublicationStatusDetails = {
  status: ZeloMenuPublicationStatus;
  label: string;
  description: string;
  issue: ZeloMenuPublicationIssue | null;
};

export type ZeloMenuPublicationSummary = {
  total: number;
  published: number;
  hidden: number;
  outOfStock: number;
  missingCategory: number;
  attention: number;
};

export function getZeloMenuPublicationStatus(
  product: ZeloMenuPublicationProduct,
): ZeloMenuPublicationStatusDetails {
  if (product.ocultar_no_pdv) {
    return {
      status: 'hidden',
      label: 'Inativo',
      description: 'Produto marcado como oculto no cardápio atual.',
      issue: 'hidden',
    };
  }

  if (product.controlar_estoque && product.estoque_atual <= 0) {
    return {
      status: 'out_of_stock',
      label: 'Sem estoque',
      description: 'Produto com estoque controlado zerado.',
      issue: 'out_of_stock',
    };
  }

  if (product.id_categoria == null) {
    return {
      status: 'missing_category',
      label: 'Sem categoria',
      description: 'Produto precisa estar em uma categoria para aparecer bem no link do cardápio.',
      issue: 'missing_category',
    };
  }

  return {
    status: 'published',
    label: 'Pronto',
    description: 'Produto ativo para o link do cardápio.',
    issue: null,
  };
}

export function summarizeZeloMenuPublication(
  products: ZeloMenuPublicationProduct[],
): ZeloMenuPublicationSummary {
  const summary: ZeloMenuPublicationSummary = {
    total: products.length,
    published: 0,
    hidden: 0,
    outOfStock: 0,
    missingCategory: 0,
    attention: 0,
  };

  for (const product of products) {
    const details = getZeloMenuPublicationStatus(product);
    if (details.status === 'published') {
      summary.published += 1;
      continue;
    }

    summary.attention += 1;
    if (details.status === 'hidden') summary.hidden += 1;
    if (details.status === 'out_of_stock') summary.outOfStock += 1;
    if (details.status === 'missing_category') summary.missingCategory += 1;
  }

  return summary;
}
