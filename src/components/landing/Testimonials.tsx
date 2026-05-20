import { Star } from 'lucide-react';
import { Marquee } from './ui/Marquee';

interface Testimonial {
  quote: string;
  name: string;
  business: string;
  initials: string;
  color: string;
}

const TESTIMONIALS_ROW_1: Testimonial[] = [
  {
    quote:
      'Antes a gente perdia pedido no domingo à noite por demora. Agora a IA atende na hora e a impressão sai direto na cozinha.',
    name: 'Marina Souza',
    business: 'Pizzaria Bella Massa',
    initials: 'MS',
    color: '#F472B6',
  },
  {
    quote:
      'A IA conhece o cardápio inteiro e responde preço, sabor e tempo de entrega sem a gente precisar digitar.',
    name: 'Rodrigo Almeida',
    business: 'Hamburgueria do Rodrigo',
    initials: 'RA',
    color: '#60A5FA',
  },
  {
    quote:
      'Integração com o ZeloPDV salvou minha vida — pedido do WhatsApp já entra direto no caixa, sem retrabalho.',
    name: 'Juliana Pereira',
    business: 'Lanchonete Sabor Caseiro',
    initials: 'JP',
    color: '#A78BFA',
  },
  {
    quote:
      'Não preciso mais responder "qual o horário?" mil vezes por dia. A IA faz isso e me liga só quando o cliente quer fechar.',
    name: 'Carlos Mendes',
    business: 'Cantina do Carlinhos',
    initials: 'CM',
    color: '#FBBF24',
  },
];

const TESTIMONIALS_ROW_2: Testimonial[] = [
  {
    quote:
      'Foi a primeira vez que eu vi um cliente elogiar a velocidade do meu atendimento. Antes ele esperava 20 minutos, agora é 20 segundos.',
    name: 'Patrícia Lima',
    business: 'Esfiharia Beirute',
    initials: 'PL',
    color: '#34D399',
  },
  {
    quote:
      'Coloquei numa segunda. Na quarta já tinha entrado 3 pedidos fora do horário comercial que eu teria perdido.',
    name: 'André Ribeiro',
    business: 'Açaí do André',
    initials: 'AR',
    color: '#F87171',
  },
  {
    quote:
      'Sem promessa milagrosa: a IA faz a triagem certa e quando precisa de mim, eu atendo já sabendo o que o cliente quer.',
    name: 'Letícia Faria',
    business: 'Marmitaria da Lê',
    initials: 'LF',
    color: '#22D3EE',
  },
  {
    quote:
      'Meu WhatsApp tinha 80 mensagens não lidas todo dia de manhã. Agora chega zerado.',
    name: 'Bruno Tavares',
    business: 'Pastelaria Boa Vista',
    initials: 'BT',
    color: '#C084FC',
  },
];

export function Testimonials() {
  return (
    <section id="beneficios" className="bg-[#F2F3F8] py-20 lg:py-24 overflow-hidden">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10">
        <div className="text-center max-w-[760px] mx-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 px-3 py-1 text-[12px] font-semibold text-[#0B7A3B]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
            Quem usa, recomenda
          </span>

          <h2 className="mt-4 text-[34px] lg:text-[40px] font-bold tracking-tight text-[#0B1120] leading-[1.15]">
            Lanchonetes que <span className="text-[#25D366]">pararam de perder</span>
            <br />
            pedido por demora
          </h2>
        </div>
      </div>

      <div className="mt-14 space-y-5 relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#F2F3F8] to-transparent z-10" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#F2F3F8] to-transparent z-10" />

        <Marquee durationSeconds={60}>
          {TESTIMONIALS_ROW_1.map((t) => (
            <div key={t.name}>
              <TestimonialCard t={t} />
            </div>
          ))}
        </Marquee>
        <Marquee durationSeconds={70} reverse>
          {TESTIMONIALS_ROW_2.map((t) => (
            <div key={t.name}>
              <TestimonialCard t={t} />
            </div>
          ))}
        </Marquee>
      </div>
    </section>
  );
}

function TestimonialCard({ t }: { t: Testimonial }) {
  return (
    <div className="w-[360px] flex-shrink-0 bg-white rounded-2xl p-6 border border-[#E5E7EB]/60 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className="w-4 h-4 fill-[#25D366] text-[#25D366]" />
        ))}
      </div>
      <p className="mt-4 text-[14px] text-[#0B1120] leading-relaxed">
        "{t.quote}"
      </p>
      <div className="mt-5 flex items-center gap-3">
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
  );
}
