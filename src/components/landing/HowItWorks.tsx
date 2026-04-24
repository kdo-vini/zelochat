import { UserPlus, Leaf, Rocket, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ZeloPDVLink } from './ZeloPDVLink';

interface Step {
  number: number;
  icon: LucideIcon;
  title: string;
  description: ReactNode;
}

const STEPS: Step[] = [
  {
    number: 1,
    icon: UserPlus,
    title: 'Crie sua conta',
    description: (
      <>
        Cadastre-se em minutos e configure seu cardápio. Se você já usa o{' '}
        <ZeloPDVLink className="text-[#25D366] font-medium hover:underline" />, os produtos já aparecem automaticamente.
      </>
    ),
  },
  {
    number: 2,
    icon: Leaf,
    title: 'Ative a IA',
    description: 'A IA aprende com seus dados e já começa a te ajudar.',
  },
  {
    number: 3,
    icon: Rocket,
    title: 'Atenda melhor e venda mais',
    description: 'Responda mais rápido, encante clientes e aumente suas vendas.',
  },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="bg-[#EEF1F7] py-20 lg:py-24">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10">
        <div className="text-center max-w-[700px] mx-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 px-3 py-1 text-[12px] font-semibold text-[#0B7A3B]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
            Como funciona
          </span>

          <h2 className="mt-4 text-[34px] lg:text-[40px] font-bold tracking-tight text-[#0B1120] leading-[1.15]">
            Em <span className="text-[#25D366]">3 passos</span> você transforma
            <br />
            seu atendimento
          </h2>
        </div>

        <div className="mt-14 relative">
          <div
            className="hidden md:block absolute top-[36px] left-[14%] right-[14%] border-t-2 border-dashed border-[#25D366]/30"
            aria-hidden="true"
          />

          <div className="grid md:grid-cols-3 gap-10 relative">
            {STEPS.map(({ number, icon: Icon, title, description }) => (
              <div key={number} className="flex flex-col items-center text-center">
                <div className="relative">
                  <div className="w-[72px] h-[72px] rounded-full bg-[#0B1120] text-white flex items-center justify-center text-[22px] font-bold shadow-[0_8px_20px_rgba(11,17,32,0.2)]">
                    {number}
                  </div>
                </div>

                <div className="mt-6 w-[88px] h-[88px] rounded-[28px] bg-[#25D366]/10 border border-[#25D366]/20 flex items-center justify-center">
                  <Icon className="w-9 h-9 text-[#25D366]" strokeWidth={1.8} />
                </div>

                <h3 className="mt-5 text-[17px] font-semibold text-[#0B1120]">{title}</h3>
                <p className="mt-2 text-[13.5px] text-[#64748B] leading-relaxed max-w-[220px]">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
