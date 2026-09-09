import { useEffect, useRef } from 'react';
import { MoreHorizontal, ShoppingBag } from 'lucide-react';
import type { View, NavItem } from './Sidebar';

interface Props {
  primaryNavItems: NavItem[];
  bottomSheetItems: NavItem[];
  activeView: View;
  moreSheetOpen: boolean;
  openEscalationCount: number;
  unreadConversationsCount: number;
  isGeneralMode: boolean;
  moreActiveViews?: ReadonlySet<View>;
  onNavigate: (view: View) => void;
  onToggleMore: () => void;
  onCloseMore: () => void;
}

export function MobileBottomNav({
  primaryNavItems, bottomSheetItems, activeView, moreSheetOpen,
  openEscalationCount, unreadConversationsCount, isGeneralMode,
  moreActiveViews,
  onNavigate, onToggleMore, onCloseMore,
}: Props) {
  const moreCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!moreSheetOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    moreCloseRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseMore(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); previous?.focus(); };
  }, [moreSheetOpen, onCloseMore]);
  return (
    <>
      <nav aria-label="Navegação principal" className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden h-[64px] items-stretch border-t border-[var(--color-line)] bg-[var(--color-surface)]">
        {primaryNavItems.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          const isAlert = item.id === 'chat' && openEscalationCount > 0;
          const badge = item.id === 'chat' ? (isAlert ? openEscalationCount : unreadConversationsCount) : 0;
          return (
            <button
              key={item.id}
              onClick={() => { onNavigate(item.id); onCloseMore(); }}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 transition-colors ${
                active ? 'text-[var(--color-brand)]' : 'text-[var(--color-ink-muted)]'
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} />
              <span className="text-[10.5px] font-medium leading-none">{item.label}</span>
              {badge > 0 && (
                <span className={`absolute top-1.5 left-1/2 ml-1 rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[9.5px] font-bold text-white ${
                  isAlert ? 'bg-[var(--color-alert)]' : 'bg-[var(--color-brand)]'
                }`}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          );
        })}
        <button
          onClick={onToggleMore}
          aria-expanded={moreSheetOpen}
          aria-haspopup="dialog"
          className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 transition-colors ${
            moreSheetOpen || (moreActiveViews?.has(activeView) ?? false) ? 'text-[var(--color-brand)]' : 'text-[var(--color-ink-muted)]'
          }`}
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={moreSheetOpen ? 2.2 : 1.8} />
          <span className="text-[10.5px] font-medium leading-none">Mais</span>
        </button>
      </nav>

      {moreSheetOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={onCloseMore} />
          <div role="dialog" aria-modal="true" aria-labelledby="mobile-more-title" className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-[var(--color-surface)] shadow-[var(--shadow-card)] pb-6">
            <div className="mx-auto mt-2 mb-2 h-1 w-10 rounded-full bg-[var(--color-line)]" />
            <h2 id="mobile-more-title" className="sr-only">Mais opções</h2>
            <div className="px-2 py-1">
              <button ref={moreCloseRef} type="button" onClick={onCloseMore} className="sr-only">Fechar Mais</button>
              {bottomSheetItems.map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { onNavigate(item.id); onCloseMore(); }}
                    aria-current={active ? 'page' : undefined}
                    className={`w-full min-h-[44px] flex items-center gap-3 rounded-xl px-3 py-3 transition-colors ${
                      active ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]' : 'text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)]'
                    }`}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={1.8} />
                    <div className="text-left">
                      <p className="text-[14px] font-medium leading-tight">{item.label}</p>
                      <p className="text-[11.5px] text-[var(--color-ink-faint)] leading-tight mt-0.5">{item.description}</p>
                    </div>
                  </button>
                );
              })}
              {!isGeneralMode && (
                <a
                  href="https://menu.zelopdv.com.br/admin"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onCloseMore}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-3 transition-colors text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)]"
                >
                  <ShoppingBag className="h-5 w-5 flex-shrink-0" strokeWidth={1.8} />
                  <div className="text-left">
                    <p className="text-[14px] font-medium leading-tight">Cardápio</p>
                    <p className="text-[11.5px] text-[var(--color-ink-faint)] leading-tight mt-0.5">Abrir ZeloMenu ↗</p>
                  </div>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
