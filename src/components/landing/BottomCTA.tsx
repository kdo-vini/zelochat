import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle } from 'lucide-react';

export function BottomCTA() {
  return (
    <section className="bg-white py-16 lg:py-20">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10">
        <div className="relative overflow-hidden rounded-3xl bg-[#0B1120] text-white px-8 py-10 lg:px-14 lg:py-12">
          <div className="pointer-events-none absolute -right-16 -bottom-16 opacity-[0.06]">
            <MessageCircle className="w-[280px] h-[280px]" strokeWidth={1.2} />
          </div>
          <div className="pointer-events-none absolute -right-20 top-10 w-[300px] h-[300px] rounded-full bg-[#25D366]/20 blur-[100px]" />

          <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div>
              <h3 className="text-[26px] lg:text-[30px] font-bold leading-[1.15] tracking-tight">
                Pronto para revolucionar
                <br />
                seu atendimento?
              </h3>
              <p className="mt-3 text-[14px] text-white/70 max-w-[500px]">
                Teste o <span className="text-[#25D366] font-medium">ZeloChat</span>{' '}
                e veja a diferença na prática.
              </p>
            </div>

            <div className="flex flex-col items-start lg:items-end gap-2">
              <Link
                to="/auth?mode=signup"
                className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1EBE5D] text-white text-[14.5px] font-semibold rounded-lg px-6 h-12 transition-colors shadow-[0_8px_24px_rgba(37,211,102,0.35)]"
              >
                Começar agora
                <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
              </Link>
              <p className="text-[12px] text-white/50">Sem cartão de crédito</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
