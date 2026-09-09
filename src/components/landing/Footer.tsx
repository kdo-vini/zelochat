import { Instagram, MessageCircle } from 'lucide-react';
import { ZeloChatLogo } from './ZeloChatLogo';

interface LinkItem {
  label: string;
  href: string;
  external?: boolean;
}

interface LinkGroup {
  title: string;
  links: LinkItem[];
}

const WHATSAPP_URL =
  'https://wa.me/5514991537503?text=Oi%2C%20eu%20vim%20pelo%20site%20do%20ZeloChat%20e%20tenho%20uma%20d%C3%BAvida.';

const GROUPS: LinkGroup[] = [
  {
    title: 'Produto',
    links: [
      { label: 'Recursos', href: '#recursos' },
      { label: 'Como funciona', href: '#como-funciona' },
      { label: 'Preços', href: '#precos' },
      { label: 'Perguntas frequentes', href: '#faq' },
    ],
  },
  {
    title: 'Suporte',
    links: [
      { label: 'Falar no WhatsApp', href: WHATSAPP_URL, external: true },
      { label: 'E-mail', href: 'mailto:techne.br@gmail.com', external: true },
    ],
  },
  {
    title: 'Téchne Sistemas',
    links: [
      { label: 'Zelo PDV', href: 'https://zelopdv.com.br', external: true },
      { label: 'Instagram', href: 'https://instagram.com/techne.ia', external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-white border-t border-[#E5E7EB]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-14 grid grid-cols-2 md:grid-cols-5 gap-10">
        <div className="col-span-2 md:col-span-2">
          <ZeloChatLogo variant="dark" />
          <p className="mt-3 text-[13px] text-[#64748B] leading-relaxed max-w-[300px]">
            Plataforma de IA para WhatsApp — atende clientes, leva pro cardápio
            online, confere PIX e organiza o kanban. Pra lanchonetes,
            hamburguerias e deliveries pararem de perder pedido.
          </p>
          <div className="mt-5 flex gap-2">
            <SocialIcon
              href={WHATSAPP_URL}
              icon={MessageCircle}
              label="WhatsApp"
              external
            />
            <SocialIcon
              href="https://instagram.com/techne.ia"
              icon={Instagram}
              label="Instagram"
              external
            />
          </div>
        </div>

        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="text-[13.5px] font-semibold text-[#0B1120] mb-3">
              {group.title}
            </p>
            <ul className="space-y-2">
              {group.links.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    {...(link.external
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                    className="text-[13px] text-[#64748B] hover:text-[#0B1120] transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-[#E5E7EB]">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-5 flex flex-col md:flex-row items-center justify-between gap-2">
          <p className="text-[12px] text-[#64748B] text-center md:text-left">
            © {new Date().getFullYear()} ZeloChat · Téchne Sistemas Ltda · CNPJ
            65.679.798/0001-95
          </p>
          <p className="text-[12px] text-[#64748B]">
            Feito no Brasil
          </p>
        </div>
      </div>
    </footer>
  );
}

function SocialIcon({
  href,
  icon: Icon,
  label,
  external,
}: {
  href: string;
  icon: typeof Instagram;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="w-9 h-9 rounded-lg bg-[#F2F3F8] hover:bg-[var(--color-brand)]/10 text-[#64748B] hover:text-[var(--color-brand)] flex items-center justify-center transition-colors"
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
    </a>
  );
}
