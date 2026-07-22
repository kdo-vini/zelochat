// Preços (atualizado 2026-07-21): ZeloChat R$149 inclui ZeloMenu (D-014),
// bundle com ZeloPDV R$198. FONTE ÚNICA de preço exibido na landing — Hero,
// BottomCTA, MobileStickyCTA e a seção de Preços leem daqui.
//
// ⚠ Os price IDs reais vêm das envs STRIPE_PRICE_CHAT / STRIPE_PRICE_BUNDLE no
// Dokploy. Ao mudar os valores abaixo, criar os prices correspondentes no Stripe
// e apontar essas envs para eles NO MESMO DEPLOY — senão o site mostra um valor
// e o checkout cobra outro. index.html (JSON-LD) e public/llms.txt têm o preço
// hard-coded (arquivos estáticos, não leem daqui) — manter em sincronia à mão.
export const PRICING = {
  chat: {
    priceBRL: 149,
    label: 'ZeloChat',
    includesZeloMenu: true,
    stripePriceIdEnv: 'STRIPE_PRICE_CHAT',
  },
  bundle: {
    priceBRL: 198,
    label: 'Pacote Gestão + Atendimento',
    includesZeloMenu: true,
    stripePriceIdEnv: 'STRIPE_PRICE_BUNDLE',
  },
} as const

export type PlanTier = keyof typeof PRICING

export function formatPriceBRL(tier: PlanTier): string {
  return `R$ ${PRICING[tier].priceBRL},00`
}
