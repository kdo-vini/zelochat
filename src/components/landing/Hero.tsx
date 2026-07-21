import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Play, Ban, Zap, Headphones, Clock, Users, Moon } from 'lucide-react';
import { ChatPreview } from './ChatPreview';
import { ZeloPDVLink } from './ZeloPDVLink';
import { PRICING } from '../../data/pricing';
import { AuroraBackground } from './ui/AuroraBackground';
import { AnimatedShinyText } from './ui/AnimatedShinyText';
import { NumberTicker } from './ui/NumberTicker';
import { BorderBeam } from './ui/BorderBeam';

export function Hero() {
  return (
    <AuroraBackground className="bg-[#0B1120] text-white" intensity="normal">
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        <div className="relative max-w-[1200px] mx-auto px-6 lg:px-10 pt-10 pb-16 lg:pt-16 lg:pb-24 grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1 text-[11.5px] font-medium text-white/70">
              <span className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-pulse" />
              Plataforma de IA para WhatsApp · lanchonetes e deliveries
            </span>

            <h1 className="mt-4 text-[40px] lg:text-[56px] leading-[1.02] font-bold tracking-tight">
              Seu cliente quer pedir{' '}
              <AnimatedShinyText className="font-bold">agora</AnimatedShinyText>.
              <br />
              Não daqui{' '}
              <span className="text-white/40 line-through decoration-[3px] decoration-red-400/60">
                20 minutos
              </span>
              .
            </h1>

            <p className="mt-5 text-[15px] lg:text-[16px] text-white/70 max-w-[560px] leading-relaxed">
              A IA atende no WhatsApp e leva o cliente pro seu{' '}
              <span className="text-white font-medium">cardápio online</span> pra
              fechar o pedido. Ela confere o comprovante PIX e joga tudo num
              kanban — sua equipe arrasta, o cliente recebe atualização sozinho.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                to="/auth?mode=signup"
                className="relative inline-flex items-center justify-center gap-2 overflow-hidden bg-[#25D366] hover:bg-[#1EBE5D] text-white text-[14.5px] font-semibold rounded-lg px-6 h-12 transition-colors shadow-[0_8px_24px_rgba(37,211,102,0.35)]"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.45) 50%, transparent 65%)',
                    backgroundSize: '200% 100%',
                    animation: 'sb-shimmer 2.6s linear infinite',
                  }}
                />
                <span className="relative z-10 inline-flex items-center gap-2">
                  Parar de perder pedidos
                  <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
                </span>
              </Link>
              <a
                href="#como-funciona"
                className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[14.5px] font-semibold rounded-lg px-5 h-12 transition-colors"
              >
                Ver como funciona
                <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
                  <Play className="w-3 h-3 fill-white" />
                </span>
              </a>
            </div>

            <p className="mt-4 text-[12.5px] text-white/55 max-w-[520px]">
              <span className="text-white/80 font-medium">R${PRICING.chat.priceBRL}/mês</span>{' '}
              com o cardápio online incluso · cancele quando quiser. Se você usa o{' '}
              <ZeloPDVLink className="text-[#25D366] font-medium hover:underline" />, já
              está integrado.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-white/60">
              <span className="inline-flex items-center gap-1.5">
                <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                Sem fidelidade
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                Configura em minutos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Headphones className="w-3.5 h-3.5" aria-hidden="true" />
                Suporte em português
              </span>
            </div>
          </div>

          <div className="relative">
            <div className="relative rounded-[24px] overflow-hidden">
              <BorderBeam size={260} duration={9} colorFrom="#25D366" colorTo="#5BE89A" />
              <ChatPreview />
            </div>
          </div>
        </div>

        <StatStrip />

        <style>{`
          @keyframes sb-shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
      </section>
    </AuroraBackground>
  );
}

function StatStrip() {
  return (
    <div className="relative border-t border-white/5 bg-[#0B1120]/60 backdrop-blur-sm">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-7 grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-4">
        <StatCard
          icon={Clock}
          headline={
            <>
              <NumberTicker value={54} />×{' '}
              <span className="text-white/70 font-normal">mais rápido</span>
            </>
          }
          sub="18 min de resposta humana vs 20 segundos da IA do ZeloChat. Cliente impaciente não espera — vai pro concorrente que respondeu primeiro."
        />
        <StatCard
          icon={Users}
          headline={
            <>
              <NumberTicker value={78} suffix="%" />{' '}
              <span className="text-white/70 font-normal">dos clientes</span>
            </>
          }
          sub="compram com a primeira empresa que responde. Se você demora pra responder no WhatsApp, é venda perdida."
        />
        <StatCard
          icon={Moon}
          headline={
            <>
              <NumberTicker value={24} suffix="h" />/
              <NumberTicker value={7} />
              <span className="text-white/70 font-normal"> · WhatsApp não dorme</span>
            </>
          }
          sub="Cliente pergunta às 23h de domingo. Sua equipe responde segunda 9h. A IA respondeu em 20s e já agendou o pedido."
        />
      </div>
      <p className="hidden md:block max-w-[1200px] mx-auto px-6 lg:px-10 pb-5 text-[11px] text-white/35">
        Fontes: tempo médio humano observado em lanchonetes parceiras;
        comportamento de compra em pesquisas de lead-response (HBR, Drift).
      </p>
    </div>
  );
}

function StatCard({
  icon: Icon,
  headline,
  sub,
}: {
  icon: typeof Clock;
  headline: ReactNode;
  sub: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 flex-shrink-0 w-9 h-9 rounded-lg bg-[#25D366]/15 border border-[#25D366]/25 flex items-center justify-center">
        <Icon className="w-[18px] h-[18px] text-[#25D366]" strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[19px] lg:text-[21px] font-bold text-white leading-tight">
          {headline}
        </p>
        <p className="hidden md:block mt-1.5 text-[12.5px] text-white/55 leading-relaxed">
          {sub}
        </p>
      </div>
    </div>
  );
}
