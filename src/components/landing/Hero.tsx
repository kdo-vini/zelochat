import { Link } from 'react-router-dom';
import { ArrowRight, Play, Ban, Zap, Headphones } from 'lucide-react';
import { ChatPreview } from './ChatPreview';
import { ZeloPDVLink } from './ZeloPDVLink';

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#0B1120] text-white">
      <div className="pointer-events-none absolute -top-32 -right-20 w-[520px] h-[520px] rounded-full bg-[#25D366]/20 blur-[120px]" />
      <div className="pointer-events-none absolute top-20 left-10 w-[360px] h-[360px] rounded-full bg-[#25D366]/10 blur-[120px]" />

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative max-w-[1200px] mx-auto px-6 lg:px-10 pt-10 pb-20 lg:pt-16 lg:pb-28 grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
        <div>
          <h1 className="mt-2 text-[44px] lg:text-[56px] leading-[1.05] font-bold tracking-tight">
            Atendimento
            <br />
            mais rápido,
            <br />
            inteligente e humano{' '}
            <span className="text-[#25D366]">com IA.</span>
          </h1>

          <p className="mt-5 text-[15px] lg:text-[16px] text-white/70 max-w-[520px] leading-relaxed">
            ZeloChat é a plataforma de atendimento com IA para WhatsApp. Cadastre seu cardápio, automatize conversas e venda mais — e, se você usa o{' '}
            <ZeloPDVLink className="text-[#25D366] font-medium hover:underline" />
            , integra na mesma conta.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/auth?mode=signup"
              className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1EBE5D] text-white text-[14.5px] font-semibold rounded-lg px-6 h-12 transition-colors shadow-[0_8px_24px_rgba(37,211,102,0.35)]"
            >
              Começar agora
              <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
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

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-white/60">
            <span className="inline-flex items-center gap-1.5">
              <Ban className="w-3.5 h-3.5" />
              Cancele quando quiser
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Configuração em minutos
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Headphones className="w-3.5 h-3.5" />
              Suporte em português
            </span>
          </div>
        </div>

        <div className="relative">
          <ChatPreview />
        </div>
      </div>
    </section>
  );
}
