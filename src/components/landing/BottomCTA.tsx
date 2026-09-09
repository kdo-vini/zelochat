import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { PRICING } from '../../data/pricing';
import { AuroraBackground } from './ui/AuroraBackground';

export function BottomCTA() {
  return (
    <section data-landing="bottom-cta" className="bg-white py-16 lg:py-20">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10">
        <AuroraBackground
          className="rounded-3xl bg-[#0B1120] text-white"
          intensity="subtle"
        >
          <div className="relative px-8 py-12 lg:px-14 lg:py-14">
            <div className="pointer-events-none absolute -right-16 -bottom-16 opacity-[0.06]">
              <MessageCircle className="w-[280px] h-[280px]" strokeWidth={1.2} />
            </div>

            <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
              <div>
                <h3 className="text-[26px] lg:text-[32px] font-bold leading-[1.1] tracking-tight">
                  Cada dia sem ZeloChat,
                  <br />
                  é <span className="text-[var(--color-brand)]">pedido indo pro concorrente.</span>
                </h3>
                <p className="mt-3 text-[14.5px] text-white/70 max-w-[520px]">
                  Configure em 10 minutos. A IA atende, leva o cliente pro seu
                  cardápio online, confere PIX e avisa o cliente a cada status.
                  Sem fidelidade — cancele direto no painel, sem ligação de
                  retenção.
                </p>
              </div>

              <div className="flex flex-col items-start lg:items-end gap-2 flex-shrink-0">
                <Link
                  to="/auth?mode=signup"
                  className="relative inline-flex items-center justify-center gap-2 overflow-hidden bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white text-[14.5px] font-semibold rounded-lg px-6 h-12 transition-colors shadow-[0_8px_24px_rgba(37,211,102,0.35)]"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        'linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.45) 50%, transparent 65%)',
                      backgroundSize: '200% 100%',
                      animation: 'bc-shimmer 2.6s linear infinite',
                    }}
                  />
                  <span className="relative z-10 inline-flex items-center gap-2">
                    Começar agora
                    <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
                  </span>
                </Link>
                <p className="text-[12px] text-white/50">
                  R${PRICING.chat.priceBRL}/mês · Cardápio online incluso · Cancele quando quiser
                </p>
              </div>
            </div>
            <style>{`
              @keyframes bc-shimmer {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
              }
            `}</style>
          </div>
        </AuroraBackground>
      </div>
    </section>
  );
}
