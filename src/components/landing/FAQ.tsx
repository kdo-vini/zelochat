import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { ZeloPDVLink } from './ZeloPDVLink';

interface QAItem {
  q: string;
  a: ReactNode;
}

const FAQS: QAItem[] = [
  {
    q: 'Preciso ter o ZeloPDV para usar o ZeloChat?',
    a: (
      <>
        Não. O ZeloChat funciona sozinho — você cadastra seus produtos, categorias e preços direto aqui e a IA já começa a atender. Se você também usa o{' '}
        <ZeloPDVLink className="text-[#0B7A3B] font-medium hover:underline" />, a conta é a mesma e o catálogo fica sincronizado automaticamente entre os dois.
      </>
    ),
  },
  {
    q: 'Como o ZeloChat conecta no meu WhatsApp?',
    a: 'Em poucos cliques você conecta seu WhatsApp ao ZeloChat e as conversas começam a chegar na plataforma em tempo real. Não precisa instalar nada no computador nem no celular.',
  },
  {
    q: 'Posso controlar quando a IA responde?',
    a: 'Pode. Cada conversa tem um botão para ligar ou desligar a IA. Você ainda pode usar o modo "sugerir resposta" (a IA escreve, você aprova antes de enviar) e montar respostas rápidas prontas para os atendentes humanos.',
  },
  {
    q: 'A IA conhece meus produtos e preços?',
    a: (
      <>
        Sim. A IA é treinada com o catálogo que você cadastra no ZeloChat — nomes, descrições, preços, políticas da loja e instruções que você definir. Se você também usa o{' '}
        <ZeloPDVLink className="text-[#0B7A3B] font-medium hover:underline" />, o catálogo é o mesmo nos dois sistemas.
      </>
    ),
  },
  {
    q: 'Meus dados e os dos meus clientes estão seguros?',
    a: 'Sim. Os dados da sua loja ficam isolados — ninguém de fora da sua conta enxerga suas conversas ou seus clientes. Todas as informações trafegam e são armazenadas de forma segura.',
  },
  {
    q: 'Preciso instalar algum programa para imprimir os pedidos?',
    a: 'Não. Você liga sua impressora térmica direto ao computador e conecta uma única vez clicando em "Conectar impressora" na barra lateral. Pronto: todo pedido confirmado pelo WhatsApp é impresso automaticamente na cozinha — sem instalar nada.',
  },
  {
    q: 'Tem contrato de fidelidade ou multa?',
    a: 'Não. Você paga mensalmente e cancela quando quiser, direto no painel. Sem fidelidade, sem multa, sem perguntas.',
  },
  {
    q: 'Como funciona o suporte?',
    a: (
      <>
        Suporte em português, pelo próprio WhatsApp e por e-mail. Atendemos em horário comercial e respondemos dúvidas técnicas, de configuração e de integração com o{' '}
        <ZeloPDVLink className="text-[#0B7A3B] font-medium hover:underline" />.
      </>
    ),
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (i: number) => {
    setOpenIndex((prev) => (prev === i ? null : i));
  };

  return (
    <section id="faq" className="bg-[#F2F3F8] py-20 lg:py-24">
      <div className="max-w-[820px] mx-auto px-6 lg:px-10">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 px-3 py-1 text-[12px] font-semibold text-[#0B7A3B]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
            FAQ
          </span>

          <h2 className="mt-4 text-[34px] lg:text-[40px] font-bold tracking-tight text-[#0B1120] leading-[1.15]">
            Perguntas <span className="text-[#25D366]">frequentes</span>
          </h2>

          <p className="mt-4 text-[15px] text-[#64748B] leading-relaxed">
            Tudo que você precisa saber antes de começar a usar.
          </p>
        </div>

        <div className="mt-12 space-y-3">
          {FAQS.map(({ q, a }, i) => {
            const open = openIndex === i;
            return (
              <div
                key={q}
                className={`rounded-2xl border transition-all ${
                  open
                    ? 'bg-white border-[#25D366]/30 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.12)]'
                    : 'bg-white border-[#E5E7EB]/80 hover:border-[#25D366]/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-4 text-left px-5 lg:px-6 py-5"
                >
                  <span className="text-[15px] lg:text-[16px] font-semibold text-[#0B1120]">
                    {q}
                  </span>
                  <span
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                      open
                        ? 'bg-[#25D366] text-white rotate-45'
                        : 'bg-[#F2F3F8] text-[#0B1120]'
                    }`}
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.4} />
                  </span>
                </button>
                <div
                  className={`grid transition-all duration-200 ease-out ${
                    open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 lg:px-6 pb-5 text-[14px] text-[#64748B] leading-relaxed">
                      {a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-[13.5px] text-[#64748B]">
          Ainda com dúvidas?{' '}
          <a
            href="https://wa.me/5514991537503?text=Oi%2C%20eu%20vim%20pelo%20site%20do%20ZeloChat%20e%20tenho%20uma%20d%C3%BAvida."
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0B7A3B] font-semibold hover:underline"
          >
            Fale com a gente
          </a>
        </p>
      </div>
    </section>
  );
}
