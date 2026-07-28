// ZeloMenu — resolver de capabilities (ZLM-205, parte local / D-103).
//
// Este módulo é a fonte ÚNICA de verdade, no repo ZeloChat, para decidir o que
// cada plano libera. Ele é domínio puro: zero React, zero acesso a banco, zero
// dependência de provider. Backend e frontend computam o mesmo resultado a
// partir dos mesmos sinais de assinatura.
//
// Decisões aplicáveis:
//  - D-005/D-100: vocabulário de capability separado de "qual app abre".
//  - D-014: ZeloChat (chat) e bundle INCLUEM ZeloMenu obrigatoriamente.
//  - D-103: `has_zelo_menu` é PDV-owned e nasce no repo ZeloPDV. Enquanto a coluna
//    não existir, o resolver é FAIL-SAFE PARA ON em chat/bundle (flipar a copy de
//    pricing nunca pode trancar quem já tem direito) e expõe UM ÚNICO seam
//    (`hasZeloMenuFlag`) para passar a ler a flag nova sem reescrever a regra.

export const ZELOMENU_CAPABILITIES = [
  'chat_app',
  'pdv_core',
  'menu_publication',
  'public_menu_runtime',
  'ordering_review',
  'kitchen_queue',
  'mesas',
  'acessos',
] as const;

export type ZeloMenuCapability = (typeof ZELOMENU_CAPABILITIES)[number];

export type ZeloMenuPlanTier = 'pdv' | 'chat' | 'bundle';

export interface ZeloMenuEntitlementSignals {
  /** `subscriptions.plan_tier`. `null` quando o cliente nunca assinou. */
  planTier: ZeloMenuPlanTier | null;
  /** Assinatura efetivamente ativa hoje (status + expiração). Já resolvido pelo chamador. */
  active: boolean;
  /**
   * SEAM ÚNICO (D-103) para o futuro `has_zelo_menu` PDV-owned.
   * `undefined`/`null` = coluna ainda não publicada → o resolver ignora e
   * mantém chat/bundle fail-safe ON. Só `true` concede ZeloMenu a um cliente
   * `pdv` puro (tier ZeloPDV + ZeloMenu R$99).
   */
  hasZeloMenuFlag?: boolean | null;
  /** Addon Mesas/comandas, comercializado separado (D-100). */
  hasMesasAddon?: boolean;
  /** Addon Acessos/subusuários, comercializado separado (D-100). */
  hasAcessosAddon?: boolean;
}

export type ZeloMenuCapabilitySet = Record<ZeloMenuCapability, boolean>;

function emptyCapabilitySet(): ZeloMenuCapabilitySet {
  return {
    chat_app: false,
    pdv_core: false,
    menu_publication: false,
    public_menu_runtime: false,
    ordering_review: false,
    kitchen_queue: false,
    mesas: false,
    acessos: false,
  };
}

/**
 * Computa o conjunto efetivo de capabilities para um conjunto de sinais de
 * assinatura. Read-only: não toca em banco nem em rede.
 */
export function resolveZeloMenuCapabilities(signals: ZeloMenuEntitlementSignals): ZeloMenuCapabilitySet {
  const caps = emptyCapabilitySet();

  // Sem assinatura ativa, nada é liberado — fail-closed na ausência de direito.
  if (!signals.active || !signals.planTier) {
    return caps;
  }

  const tier = signals.planTier;
  const isChatTier = tier === 'chat' || tier === 'bundle';
  const isPdvTier = tier === 'pdv' || tier === 'bundle';

  // SEAM: só `true` explícito concede ZeloMenu a `pdv` puro. `null`/`undefined`
  // (coluna ainda não publicada) e `false` não concedem — mas tampouco trancam
  // chat/bundle, que entram por D-014 abaixo.
  const hasZeloMenuExplicit = signals.hasZeloMenuFlag === true;
  caps.chat_app = isChatTier;
  caps.pdv_core = isPdvTier;

  // Acesso ao ZeloMenu (publicação + runtime do menu público):
  //  - chat/bundle: ON sempre (D-014, fail-safe ON);
  //  - pdv puro: só com a flag nova explícita (tier R$99);
  const zeloMenuAccess = isChatTier || (isPdvTier && hasZeloMenuExplicit);
  caps.menu_publication = zeloMenuAccess;
  caps.public_menu_runtime = zeloMenuAccess;

  // Revisão/aceite de pedidos online:
  //  - chat/bundle: ON;
  //  - pdv com ZeloMenu novo: ON.
  const orderingReview = isChatTier || (isPdvTier && hasZeloMenuExplicit);
  caps.ordering_review = orderingReview;

  // Fila de cozinha: tudo que libera ordering_review, mais Mesas com cozinha
  // (D-100: mesas pode justificar kitchen_queue sem implicar ordering_review).
  caps.kitchen_queue = orderingReview || signals.hasMesasAddon === true;

  caps.mesas = signals.hasMesasAddon === true;
  caps.acessos = signals.hasAcessosAddon === true;

  return caps;
}

/** Atalho legível para checar uma capability específica. */
export function hasZeloMenuCapability(
  set: ZeloMenuCapabilitySet,
  capability: ZeloMenuCapability,
): boolean {
  return set[capability] === true;
}

/**
 * Acesso ao ZeloMenu (publicação self-service + menu público). É o gate que o
 * `Cardápio`/publicação usa no app ZeloChat.
 */
export function hasZeloMenuAccess(signals: ZeloMenuEntitlementSignals): boolean {
  return resolveZeloMenuCapabilities(signals).menu_publication;
}
