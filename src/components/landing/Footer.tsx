import { Instagram, Youtube, BarChart3 } from 'lucide-react';
import { ZeloChatLogo } from './ZeloChatLogo';

interface LinkGroup {
  title: string;
  links: { label: string; href: string }[];
}

const GROUPS: LinkGroup[] = [
  {
    title: 'Produto',
    links: [
      { label: 'Recursos', href: '#recursos' },
      { label: 'Benefícios', href: '#beneficios' },
      { label: 'Preços', href: '#precos' },
    ],
  },
  {
    title: 'Empresa',
    links: [
      { label: 'Sobre', href: '#' },
      { label: 'Blog', href: '#' },
      { label: 'Contato', href: '#' },
    ],
  },
  {
    title: 'Suporte',
    links: [
      { label: 'Central de ajuda', href: '#' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Suporte', href: '#' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-white border-t border-[#E5E7EB]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-14 grid grid-cols-2 md:grid-cols-5 gap-10">
        <div className="col-span-2 md:col-span-2">
          <ZeloChatLogo variant="dark" />
          <p className="mt-3 text-[13px] text-[#64748B] leading-relaxed max-w-[260px]">
            A plataforma de atendimento com IA para WhatsApp.
          </p>
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
                    className="text-[13px] text-[#64748B] hover:text-[#0B1120] transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <p className="text-[13.5px] font-semibold text-[#0B1120] mb-3">Siga-nos</p>
          <div className="flex gap-2">
            <SocialIcon href="#" icon={Instagram} label="Instagram" />
            <SocialIcon href="#" icon={Youtube} label="YouTube" />
            <SocialIcon href="#" icon={BarChart3} label="Analytics" />
          </div>
        </div>
      </div>

      <div className="border-t border-[#E5E7EB]">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-5">
          <p className="text-center text-[12px] text-[#64748B]">
            © 2026 ZeloChat. Todos os direitos reservados.
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
}: {
  href: string;
  icon: typeof Instagram;
  label: string;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className="w-9 h-9 rounded-lg bg-[#F2F3F8] hover:bg-[#25D366]/10 text-[#64748B] hover:text-[#25D366] flex items-center justify-center transition-colors"
    >
      <Icon className="w-4 h-4" />
    </a>
  );
}
