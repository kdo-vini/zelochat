import {
  MessageSquareText,
  Sparkles,
  Link2,
  MessageCircle,
  FileText,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ZeloPDVLink } from './ZeloPDVLink';

interface Feature {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
}

const FEATURES: Feature[] = [
  {
    icon: MessageSquareText,
    title: 'Respostas com IA',
    description:
      'A IA entende e responde automaticamente perguntas de clientes com base no seu catálogo, políticas e histórico.',
  },
  {
    icon: Sparkles,
    title: 'Sugestões inteligentes',
    description:
      'A IA sugere produtos, promoções e respostas para aumentar suas chances de venda.',
  },
  {
    icon: Link2,
    title: 'Integração nativa',
    description: (
      <>
        Já usa o <ZeloPDVLink className="text-[#0B7A3B] font-medium hover:underline" />
        ? Produtos, estoque, pedidos e clientes ficam sincronizados em tempo real — mesma conta.
      </>
    ),
  },
  {
    icon: MessageCircle,
    title: 'Atendimento pelo WhatsApp',
    description:
      'Centralize todas as conversas do WhatsApp da sua empresa em um só lugar, com histórico completo por cliente.',
  },
  {
    icon: FileText,
    title: 'Resumos e históricos',
    description:
      'Tenha resumo automático das conversas e histórico completo de cada cliente.',
  },
  {
    icon: BarChart3,
    title: 'Relatórios e insights',
    description:
      'Acompanhe métricas de atendimento, tempo de resposta e oportunidades de vendas.',
  },
];

export function FeaturesGrid() {
  return (
    <section id="recursos" className="bg-[#F2F3F8] py-20 lg:py-24">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10">
        <div className="text-center max-w-[700px] mx-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 px-3 py-1 text-[12px] font-semibold text-[#0B7A3B]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
            Recursos
          </span>

          <h2 className="mt-4 text-[34px] lg:text-[40px] font-bold tracking-tight text-[#0B1120] leading-[1.15]">
            Tudo que você precisa para
            <br />
            atender melhor <span className="text-[#25D366]">com IA</span>
          </h2>

          <p className="mt-4 text-[15px] text-[#64748B] leading-relaxed">
            Recursos inteligentes que ajudam sua equipe a ser mais produtiva
            <br className="hidden md:block" />
            e seus clientes a terem a melhor experiência.
          </p>
        </div>

        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="group bg-white rounded-2xl p-7 border border-[#E5E7EB]/60 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_12px_32px_-12px_rgba(15,23,42,0.12)] hover:border-[#25D366]/30 transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-[#25D366]/10 flex items-center justify-center mb-5 group-hover:bg-[#25D366]/15 transition-colors">
                <Icon className="w-[22px] h-[22px] text-[#25D366]" strokeWidth={2} />
              </div>
              <h3 className="text-[16.5px] font-semibold text-[#0B1120]">{title}</h3>
              <p className="mt-2 text-[13.5px] text-[#64748B] leading-relaxed">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
