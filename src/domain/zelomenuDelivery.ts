// ZeloMenu — taxa de entrega por bairro (FONTE ÚNICA, node-free).
//
// Extraído de `zelomenuCart.ts` (ZLM-204 → hardening Q5) porque aquele módulo
// importa `node:crypto` para os tokens públicos e não pode entrar no bundle do
// navegador. Aqui não há dependência de node, então o backend
// (`server/zelomenuCartSessions.ts`) e o front (`ZeloMenuCartPage`) importam
// EXATAMENTE a mesma função — o total exibido no carrinho público nunca diverge
// do total revalidado pelo servidor.

import { normalizeComparableText } from './pixReceipt';

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export type ZeloMenuResolvedDeliveryFee = {
  fee: number;
  /** true quando a taxa não veio da tabela de bairros e precisa ser confirmada pela loja. */
  toConfirm: boolean;
};

/**
 * Resolve a taxa de entrega a partir da tabela simples por bairro (D-082).
 *
 * Regras de produto (D-081/D-082/D-083):
 *  - retirada não tem taxa;
 *  - bairro listado soma a taxa cadastrada (match case/acento-insensitive);
 *  - bairro livre fora da lista (ou entrega sem bairro definido) NÃO bloqueia:
 *    a taxa fica "a confirmar" (fee 0) e o pedido força conferência humana.
 *
 * O gate de "loja não faz entrega" (deliveryConfig.enabled) fica no chamador.
 */
export function resolveDeliveryFeeForNeighborhood(input: {
  type: 'pickup' | 'delivery';
  neighborhood: string | null;
  neighborhoods: Array<{ name: string; fee: number }>;
}): ZeloMenuResolvedDeliveryFee {
  if (input.type !== 'delivery') return { fee: 0, toConfirm: false };

  const trimmed = (input.neighborhood ?? '').trim();
  if (!trimmed) return { fee: 0, toConfirm: true };

  const target = normalizeComparableText(trimmed);
  const match = input.neighborhoods.find(
    (item) => normalizeComparableText(item.name) === target,
  );
  if (!match) return { fee: 0, toConfirm: true };

  return { fee: roundCurrency(Number(match.fee) || 0), toConfirm: false };
}
