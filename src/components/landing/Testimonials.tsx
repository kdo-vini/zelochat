import { Star } from 'lucide-react';

interface Testimonial {
  quote: string;
  name: string;
  business: string;
  initials: string;
  color: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      'O ZeloChat nos ajudou a reduzir pela metade o tempo de resposta e aumentou muito nossas vendas!',
    name: 'Mariana Costa',
    business: 'Loja da Gente',
    initials: 'MC',
    color: '#F472B6',
  },
  {
    quote:
      'A IA entende muito bem nossos produtos e os clientes ficam impressionados com a agilidade.',
    name: 'Rafael Martins',
    business: 'EletroLar',
    initials: 'RM',
    color: '#60A5FA',
  },
  {
    quote:
      'Integração perfeita com o ZeloPDV e suporte incrível. Recomendo demais!',
    name: 'Juliana Andrade',
    business: 'Moda & Estilo',
    initials: 'JA',
    color: '#A78BFA',
  },
];

export function Testimonials() {
  return (
    <section id="beneficios" className="bg-[#F2F3F8] py-20 lg:py-24">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10">
        <div className="text-center max-w-[760px] mx-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 px-3 py-1 text-[12px] font-semibold text-[#0B7A3B]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
            Quem usa, recomenda
          </span>

          <h2 className="mt-4 text-[34px] lg:text-[40px] font-bold tracking-tight text-[#0B1120] leading-[1.15]">
            Empresas que já aumentaram
            <br />
            seus resultados com o{' '}
            <span className="text-[#25D366]">ZeloChat</span>
          </h2>
        </div>

        <div className="mt-14 grid md:grid-cols-3 gap-5 lg:gap-6">
          {TESTIMONIALS.map((t) => (
            <div
              key={t.name}
              className="bg-white rounded-2xl p-7 border border-[#E5E7EB]/60 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            >
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-[#25D366] text-[#25D366]" />
                ))}
              </div>
              <p className="mt-4 text-[14.5px] text-[#0B1120] leading-relaxed">
                "{t.quote}"
              </p>
              <div className="mt-6 flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[13px] font-semibold flex-shrink-0"
                  style={{ backgroundColor: t.color }}
                >
                  {t.initials}
                </div>
                <div>
                  <p className="text-[13.5px] font-semibold text-[#0B1120] leading-tight">
                    {t.name}
                  </p>
                  <p className="text-[12px] text-[#64748B] mt-0.5">{t.business}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
