export const PRICING = {
  chat: {
    priceBRL: 97,
    label: 'ZeloChat Pro',
    stripePriceIdEnv: 'STRIPE_PRICE_CHAT',
  },
  bundle: {
    priceBRL: 147,
    label: 'Pacote Gestão + Atendimento',
    stripePriceIdEnv: 'STRIPE_PRICE_BUNDLE',
  },
} as const

export type PlanTier = keyof typeof PRICING

export function formatPriceBRL(tier: PlanTier): string {
  return `R$ ${PRICING[tier].priceBRL},00`
}
