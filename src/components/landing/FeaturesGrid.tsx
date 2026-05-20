import { Fragment } from 'react';
import {
  Sparkles,
  Link2,
  Printer,
  HandHelping,
  Receipt,
  LayoutGrid,
  CheckCircle2,
  Bell,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ZeloPDVLink } from './ZeloPDVLink';

interface Feature {
  icon: LucideIcon;
  title: ReactNode;
  description: ReactNode;
  visual?: ReactNode;
  highlight?: boolean;
}

const HERO_FEATURES: Feature[] = [
  {
    icon: HandHelping,
    title: 'A IA fecha o pedido sozinha',
    description: (
      <>
        Cardápio, adicionais, entrega, retirada, observações. A IA conversa,
        monta o pedido e fecha. Quando ela tem dúvida, passa pra você com o
        contexto pronto.
      </>
    ),
    visual: <ChatFlowVisual />,
    highlight: true,
  },
  {
    icon: Receipt,
    title: 'Confere PIX por foto ou PDF',
    description: (
      <>
        Cliente manda print ou PDF do comprovante. A IA lê o anexo, identifica{' '}
        <span className="text-[#0B1120] font-medium">nome e valor</span>, e
        ajuda sua equipe a validar em segundos.
      </>
    ),
    visual: <PixVisual />,
  },
  {
    icon: LayoutGrid,
    title: 'Kanban que avisa o cliente sozinho',
    description: (
      <>
        Arrasta o card entre Novo, Em preparo, Pronto e Entregue. A cada
        mudança importante, o cliente recebe mensagem automática no WhatsApp.
      </>
    ),
    visual: <KanbanVisual />,
  },
];

const SUPPORTING_FEATURES: Feature[] = [
  {
    icon: Sparkles,
    title: 'Modo sugerir',
    description:
      'A IA escreve o rascunho, você aprova antes de enviar. Velocidade da IA com o controle do humano.',
  },
  {
    icon: Printer,
    title: 'Impressão na cozinha',
    description:
      'Impressora térmica USB plugada no computador, sem instalar nada. Pedido confirmado = ticket sai automático.',
  },
  {
    icon: Link2,
    title: (
      <>
        Integra com o <ZeloPDVLink className="hover:underline" />
      </>
    ),
    description: (
      <>
        Mesma conta, mesmo catálogo. Produtos, estoque e pedidos sincronizam em
        tempo real — zero retrabalho.
      </>
    ),
  },
];

export function FeaturesGrid() {
  return (
    <section id="recursos" className="bg-[#F2F3F8] py-20 lg:py-24">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10">
        <div className="text-center max-w-[760px] mx-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 px-3 py-1 text-[12px] font-semibold text-[#0B7A3B]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" aria-hidden="true" />
            Recursos
          </span>

          <h2 className="mt-4 text-[34px] lg:text-[40px] font-bold tracking-tight text-[#0B1120] leading-[1.15]">
            Não é só chatbot. É o{' '}
            <span className="text-[#25D366]">fluxo de pedidos</span>
            <br className="hidden md:block" />
            {' '}da sua loja rodando dentro do WhatsApp.
          </h2>

          <p className="mt-4 text-[15px] text-[#64748B] leading-relaxed">
            A IA resolve o previsível — cardápio, preço, pedido, comprovante PIX.
            <br className="hidden md:block" />
            Sua equipe assume o que exige humano. Menos pedido perdido, menos
            bagunça no WhatsApp.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
          {HERO_FEATURES.map((f, i) => (
            <Fragment key={i}>
              <HeroFeatureCard feature={f} />
            </Fragment>
          ))}
        </div>

        <div className="mt-5 lg:mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 lg:gap-6">
          {SUPPORTING_FEATURES.map((f, i) => (
            <Fragment key={i}>
              <SupportingFeatureCard feature={f} />
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroFeatureCard({ feature }: { feature: Feature }) {
  const { icon: Icon, title, description, visual, highlight } = feature;
  return (
    <article
      className={`group relative rounded-2xl overflow-hidden flex flex-col transition-all ${
        highlight
          ? 'bg-gradient-to-br from-white to-[#F0FDF4] border border-[#25D366]/30 shadow-[0_12px_40px_-16px_rgba(37,211,102,0.25)]'
          : 'bg-white border border-[#E5E7EB]/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#25D366]/30 hover:shadow-[0_12px_32px_-12px_rgba(15,23,42,0.12)]'
      }`}
    >
      <div className="p-6 lg:p-7 flex-1">
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${
            highlight
              ? 'bg-[#25D366] text-white'
              : 'bg-[#25D366]/10 text-[#0B7A3B]'
          }`}
        >
          <Icon className="w-[20px] h-[20px]" strokeWidth={2} aria-hidden="true" />
        </div>
        <h3 className="text-[17px] lg:text-[18px] font-semibold text-[#0B1120] leading-snug">
          {title}
        </h3>
        <p className="mt-2 text-[13.5px] text-[#64748B] leading-relaxed">
          {description}
        </p>
      </div>
      {visual && (
        <div className="px-6 lg:px-7 pb-6 lg:pb-7">{visual}</div>
      )}
    </article>
  );
}

function SupportingFeatureCard({ feature }: { feature: Feature }) {
  const { icon: Icon, title, description } = feature;
  return (
    <article className="rounded-2xl bg-white border border-[#E5E7EB]/70 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#25D366]/30 hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.1)] transition-all">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-[#25D366]/10 text-[#0B7A3B] flex items-center justify-center flex-shrink-0">
          <Icon className="w-[18px] h-[18px]" strokeWidth={2} aria-hidden="true" />
        </div>
        <h3 className="text-[15px] font-semibold text-[#0B1120] leading-tight">
          {title}
        </h3>
      </div>
      <p className="text-[13px] text-[#64748B] leading-relaxed">{description}</p>
    </article>
  );
}

function ChatFlowVisual() {
  return (
    <div className="rounded-xl bg-[#0F172A] p-3 space-y-1.5 shadow-inner">
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-md rounded-tr-sm bg-[#D9FDD3] text-[#111B21] text-[11.5px] px-2.5 py-1.5 leading-snug">
          2 x-salada e 1 Coca 2L
        </div>
      </div>
      <div className="flex">
        <div className="max-w-[85%] rounded-md rounded-tl-sm bg-white text-[#111B21] text-[11.5px] px-2.5 py-1.5 leading-snug">
          Fechou! Total <span className="font-semibold">R$ 67,90</span>. Endereço?
        </div>
      </div>
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-md rounded-tr-sm bg-[#D9FDD3] text-[#111B21] text-[11.5px] px-2.5 py-1.5 leading-snug">
          Rua das Flores, 120
        </div>
      </div>
    </div>
  );
}

function PixVisual() {
  return (
    <div className="rounded-xl bg-white border border-[#E5E7EB] p-3 flex items-center gap-3">
      <div className="w-11 h-11 rounded-lg bg-[#25D366]/15 flex items-center justify-center flex-shrink-0">
        <Receipt className="w-5 h-5 text-[#0B7A3B]" strokeWidth={2} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0B7A3B]">
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          PIX validado
        </div>
        <p className="text-[11px] text-[#64748B] mt-0.5 truncate">
          Juliana Silva · R$ 67,90
        </p>
      </div>
    </div>
  );
}

function KanbanVisual() {
  return (
    <div className="rounded-xl bg-white border border-[#E5E7EB] p-2.5 grid grid-cols-3 gap-1.5">
      <KanbanCol label="Novo" tone="slate" cards={1} />
      <KanbanCol label="Preparo" tone="amber" cards={2} active />
      <KanbanCol label="Pronto" tone="green" cards={1} />
      <div className="col-span-3 mt-1 flex items-center justify-between text-[10px] text-[#64748B] px-1">
        <span className="inline-flex items-center gap-1">
          <Bell className="w-3 h-3 text-[#25D366]" aria-hidden="true" />
          Cliente avisado
        </span>
        <span className="inline-flex items-center gap-1 text-[#0B1120] font-medium">
          arrasta
          <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

function KanbanCol({
  label,
  tone,
  cards,
  active,
}: {
  label: string;
  tone: 'slate' | 'amber' | 'green';
  cards: number;
  active?: boolean;
}) {
  const toneMap: Record<string, string> = {
    slate: 'bg-[#F2F3F8] text-[#64748B]',
    amber: 'bg-[#FEF3C7] text-[#92400E]',
    green: 'bg-[#DCFCE7] text-[#166534]',
  };
  return (
    <div
      className={`rounded-md p-1.5 ${active ? 'ring-2 ring-[#25D366]/40' : ''}`}
      style={{ background: '#F8FAFC' }}
    >
      <div
        className={`text-[9px] uppercase tracking-wide font-semibold rounded px-1 py-0.5 text-center ${toneMap[tone]}`}
      >
        {label}
      </div>
      <div className="mt-1 space-y-1">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="h-3 rounded bg-[#E5E7EB]" />
        ))}
      </div>
    </div>
  );
}
