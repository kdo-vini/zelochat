import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ZeloChatLogo } from './ZeloChatLogo';

const NAV_LINKS = [
  { label: 'Recursos', href: '#recursos' },
  { label: 'Benefícios', href: '#beneficios' },
  { label: 'Como funciona', href: '#como-funciona' },
  { label: 'Preços', href: '#precos' },
  { label: 'FAQ', href: '#faq' },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all ${
        scrolled
          ? 'bg-[#0B1120]/95 backdrop-blur-md border-b border-white/5'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 h-[72px] flex items-center justify-between">
        <Link to="/" className="flex items-center">
          <ZeloChatLogo variant="light" />
        </Link>

        <nav className="hidden lg:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[14px] text-white/70 hover:text-white transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            to="/auth"
            className="hidden sm:inline-flex text-[14px] font-medium text-white/80 hover:text-white px-3 py-2 transition-colors"
          >
            Entrar
          </Link>
          <Link
            to="/auth?mode=signup"
            className="inline-flex items-center gap-1.5 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white text-[13.5px] font-semibold rounded-lg px-4 h-10 transition-colors shadow-[0_4px_14px_rgba(37,211,102,0.25)]"
          >
            Começar agora
            <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
          </Link>
        </div>
      </div>
    </header>
  );
}
