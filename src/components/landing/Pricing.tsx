import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { ZeloPDVLink } from './ZeloPDVLink';
import { PRICING } from '../../data/pricing';

const INCLUDED: ReactNode[] = [
  'Atendimento ilimitado pelo WhatsApp',
  'IA treinada com seu catálogo e políticas',
  'Cadastro de produtos e categorias',
  <>
    Integração nativa com o{' '}
    <ZeloPDVLink className="text-white font-medium hover:underline" />{' '}
    (se você usa)
  </>,
  'Respostas automáticas e sugestões',
  'Kanban de pedidos e gestão de entregadores',
  'Resumos e histórico de conversas',
  'Suporte em português',
];

export function Pricing() {
  return (
    <section id="precos" className="bg-white py-20 lg:py-24">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10">
        <div className="text-center max-w-[700px] mx-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 px-3 py-1 text-[12px] font-semibold text-[#0B7A3B]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
            Preços
          </span>

          <h2 className="mt-4 text-[34px] lg:text-[40px] font-bold tracking-tight text-[#0B1120] leading-[1.15]">
            Um plano simples,
            <br />
            <span className="text-[#25D366]">sem pegadinhas.</span>
          </h2>

          <p className="mt-4 text-[15px] text-[#64748B] leading-relaxed">
            Tudo incluso, sem limites de conversas ou de atendentes.
            <br className="hidden md:block" />
            Cancele quando quiser.
          </p>
        </div>

        <div className="mt-14 max-w-[520px] mx-auto">
          <div className="relative rounded-[24px] bg-[#0B1120] text-white p-8 lg:p-10 shadow-[0_32px_80px_-20px_rgba(11,17,32,0.35)] overflow-hidden">
            <div className="pointer-events-none absolute -top-20 -right-20 w-[260px] h-[260px] rounded-full bg-[#25D366]/25 blur-[100px]" />

            <div className="relative">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/10 px-3 py-1 text-[11.5px] font-medium text-white/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
                  Plano único
                </span>
                <span className="text-[11.5px] text-white/50">Mensal</span>
              </div>

              <h3 className="mt-6 text-[22px] font-bold">ZeloChat Pro</h3>
              <p className="mt-1 text-[13.5px] text-white/60">
                Para lojas e lanchonetes que querem vender mais pelo WhatsApp.
              </p>

              <div className="mt-8 flex items-baseline gap-2">
                <span className="text-[15px] text-white/60">R$</span>
                <span className="text-[56px] font-bold tracking-tight leading-none">{PRICING.chat.priceBRL}</span>
                <span className="text-[15px] text-white/60">/mês</span>
              </div>
              <p className="mt-1 text-[12.5px] text-white/50">
                Cobrado mensalmente · Sem fidelidade
              </p>

              <Link
                to="/auth?mode=signup"
                className="mt-8 inline-flex w-full items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1EBE5D] text-white text-[14.5px] font-semibold rounded-lg h-12 transition-colors shadow-[0_8px_24px_rgba(37,211,102,0.35)]"
              >
                Começar agora
                <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
              </Link>

              <ul className="mt-8 space-y-3">
                {INCLUDED.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-[13.5px] text-white/85">
                    <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-[#25D366]/15 border border-[#25D366]/30 flex items-center justify-center">
                      <Check className="w-3 h-3 text-[#25D366]" strokeWidth={3} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-6 text-center text-[12.5px] text-[#64748B]">
            Precisa de algo diferente?{' '}
            <a
              href="https://wa.me/5514991537503?text=Oi%2C%20eu%20vim%20pelo%20site%20do%20ZeloChat%20e%20tenho%20uma%20d%C3%BAvida."
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#0B7A3B] font-medium hover:underline"
            >
              Fale com a gente
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
