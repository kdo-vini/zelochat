import {
  MessageCircle,
  UtensilsCrossed,
  Receipt,
  LayoutGrid,
  Bell,
  type LucideIcon,
} from 'lucide-react';

interface Step {
  number: number;
  icon: LucideIcon;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    number: 1,
    icon: MessageCircle,
    title: 'Cliente chama no WhatsApp',
    description:
      'A IA responde em segundos, tira dúvidas e manda o link do cardápio online.',
  },
  {
    number: 2,
    icon: UtensilsCrossed,
    title: 'Cliente monta o pedido no cardápio',
    description:
      'Itens, adicionais, endereço e taxa de entrega — tudo pelo seu cardápio online.',
  },
  {
    number: 3,
    icon: Receipt,
    title: 'Cliente envia o PIX',
    description:
      'A IA lê imagem ou PDF do comprovante e identifica valor e nome.',
  },
  {
    number: 4,
    icon: LayoutGrid,
    title: 'Pedido cai no kanban',
    description:
      'Sua equipe arrasta entre Novo, Em preparo, Pronto e Entregue.',
  },
  {
    number: 5,
    icon: Bell,
    title: 'Cliente recebe atualizações',
    description:
      'Cada mudança importante dispara mensagem automática no WhatsApp.',
  },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="bg-[#EEF1F7] py-20 lg:py-24">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10">
        <div className="text-center max-w-[760px] mx-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand)]/10 border border-[var(--color-brand)]/20 px-3 py-1 text-[12px] font-semibold text-[#0B7A3B]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
            Como funciona
          </span>

          <h2 className="mt-4 text-[34px] lg:text-[40px] font-bold tracking-tight text-[#0B1120] leading-[1.15]">
            Do <span className="text-[var(--color-brand)]">"oi"</span> ao pedido pronto
          </h2>
          <p className="mt-4 text-[15px] text-[#64748B] leading-relaxed">
            Cinco etapas. Uma conversa só. Sua equipe foca no que importa:
            preparar e entregar.
          </p>
        </div>

        <div className="mt-14 relative">
          <div
            className="hidden lg:block absolute top-[36px] left-[8%] right-[8%] border-t-2 border-dashed border-[var(--color-brand)]/30"
            aria-hidden="true"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-5 relative">
            {STEPS.map(({ number, icon: Icon, title, description }) => (
              <div
                key={number}
                className="flex flex-col items-center text-center"
              >
                <div className="relative">
                  <div className="w-[72px] h-[72px] rounded-full bg-[#0B1120] text-white flex items-center justify-center text-[22px] font-bold shadow-[0_8px_20px_rgba(11,17,32,0.2)]">
                    {number}
                  </div>
                </div>

                <div className="mt-5 w-[76px] h-[76px] rounded-[24px] bg-[var(--color-brand)]/10 border border-[var(--color-brand)]/25 flex items-center justify-center">
                  <Icon className="w-8 h-8 text-[#0B7A3B]" strokeWidth={1.8} />
                </div>

                <h3 className="mt-4 text-[15.5px] font-semibold text-[#0B1120] leading-snug max-w-[200px]">
                  {title}
                </h3>
                <p className="mt-2 text-[13px] text-[#64748B] leading-relaxed max-w-[220px]">
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
