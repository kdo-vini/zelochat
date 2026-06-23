// Preços novos (D-104, go-live 2026-06-23): ZeloChat R$147 inclui ZeloMenu (D-014),
// bundle R$197. Os price IDs reais vêm das envs STRIPE_PRICE_CHAT / STRIPE_PRICE_BUNDLE
// no Dokploy, que devem apontar para os prices v2 (zelo_chat_monthly_v2 / zelo_bundle_monthly_v2)
// no mesmo momento desta virada de copy.
export const PRICING = {
  chat: {
    priceBRL: 147,
    label: 'ZeloChat',
    includesZeloMenu: true,
    stripePriceIdEnv: 'STRIPE_PRICE_CHAT',
  },
  bundle: {
    priceBRL: 197,
    label: 'Pacote Gestão + Atendimento',
    includesZeloMenu: true,
    stripePriceIdEnv: 'STRIPE_PRICE_BUNDLE',
  },
} as const

export type PlanTier = keyof typeof PRICING

export function formatPriceBRL(tier: PlanTier): string {
  return `R$ ${PRICING[tier].priceBRL},00`
}
