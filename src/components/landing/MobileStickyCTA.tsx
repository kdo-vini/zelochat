import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export function MobileStickyCTA() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const hero = document.querySelector<HTMLElement>('h1');
      const bottomCTA = document.querySelector<HTMLElement>('[data-landing="bottom-cta"]');
      const heroHidden = hero ? hero.getBoundingClientRect().bottom < 0 : false;
      const bottomCTAVisible = bottomCTA
        ? bottomCTA.getBoundingClientRect().top < window.innerHeight - 40
        : false;
      setVisible(heroHidden && !bottomCTAVisible);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div
      aria-hidden={!visible}
      className={`md:hidden fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ${
        visible ? 'translate-y-0' : 'translate-y-full pointer-events-none'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="bg-[#0B1120]/95 backdrop-blur-md border-t border-white/10 px-4 py-3 flex items-center justify-between gap-3 shadow-[0_-8px_24px_rgba(0,0,0,0.25)]">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white leading-tight">
            Parar de perder pedido
          </p>
          <p className="text-[11px] text-white/55 leading-tight mt-0.5">
            R$97/mês · cancele quando quiser
          </p>
        </div>
        <Link
          to="/auth?mode=signup"
          className="inline-flex items-center gap-1.5 bg-[#25D366] hover:bg-[#1EBE5D] text-white text-[13.5px] font-semibold rounded-lg px-4 h-10 transition-colors shadow-[0_4px_14px_rgba(37,211,102,0.35)] flex-shrink-0"
        >
          Começar
          <ArrowRight className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
