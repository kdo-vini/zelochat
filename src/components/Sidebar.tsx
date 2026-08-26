import React, { memo } from 'react';
import {
  Coffee,
  PanelLeftClose,
  PanelLeftOpen,
  ShoppingBag,
  Bike,
  Bot,
  Calendar as CalendarIcon,
  Kanban,
  LayoutDashboard,
  MessageCircle,
  Settings,
  Sparkles,
} from 'lucide-react';
import { PrinterButton } from './PrinterButton';
import type { Order } from '../types';
import type { UsePrinterReturn } from '../hooks/usePrinter';
import {
  GENERAL_ALLOWED_VIEWS,
  RESTAURANT_ONLY_VIEWS,
  type NavItem,
  type View,
} from '../domain/navigation';
export { GENERAL_ALLOWED_VIEWS, RESTAURANT_ONLY_VIEWS } from '../domain/navigation';
export type { NavItem, View } from '../domain/navigation';

// Kept as compatibility aliases for callers outside AppShell. The definition
// and ordering itself lives in domain/navigation.ts.
import { getDesktopNavigation } from '../domain/navigation';
export const NAV_PRIMARY: NavItem[] = getDesktopNavigation('restaurant').primary;
export const NAV_SECONDARY: NavItem[] = getDesktopNavigation('restaurant').secondary;

/* ─── NavButton ───────────────────────────────────────────────── */
interface NavButtonProps {
  item: NavItem;
  active: boolean;
  expanded: boolean;
  badge?: number;
  badgeTone?: 'unread' | 'alert';
  onClick: () => void;
}

const NavButton: React.FC<NavButtonProps> = memo(({ item, active, expanded, badge, badgeTone = 'unread', onClick }) => {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      title={!expanded ? item.label : undefined}
      className={`group relative w-full flex items-center rounded-[10px] transition-all ${
        expanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-0 py-2.5'
      } ${
        active
          ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
          : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]'
      }`}
    >
      <Icon className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={active ? 2.2 : 1.8} />
      {expanded && (
        <div className="flex-1 text-left overflow-hidden">
          <p className="text-[13.5px] font-medium leading-tight">{item.label}</p>
          <p className="text-[11px] text-[var(--color-ink-faint)] truncate mt-[-1px]">{item.description}</p>
        </div>
      )}
      {badge != null && badge > 0 && (
        <span className={`flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-white text-[10px] font-bold ${
          badgeTone === 'alert' ? 'bg-[var(--color-alert)]' : 'bg-[#25D366]'
        } ${
          expanded ? '' : 'absolute top-1.5 right-1.5 min-w-[14px] h-[14px] text-[9px]'
        }`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {!expanded && (
        <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-md bg-[var(--color-ink)] px-2.5 py-1.5 text-[12px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          {item.label}
        </span>
      )}
    </button>
  );
});
NavButton.displayName = 'NavButton';

/* ─── Sidebar (desktop) ───────────────────────────────────────── */
interface Props {
  activeView: View;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (view: View) => void;
  primaryNavItems: NavItem[];
  secondaryNavItems: NavItem[];
  openEscalationCount: number;
  unreadConversationsCount: number;
  isGeneralMode: boolean;
  firstNameOnly: string;
  profileAvatar: string;
  profileRole: string;
  printer: UsePrinterReturn;
  testOrder?: Order;
}

export function Sidebar({
  activeView, expanded, onToggle, onNavigate,
  primaryNavItems, secondaryNavItems,
  openEscalationCount, unreadConversationsCount,
  isGeneralMode, firstNameOnly, profileAvatar, profileRole,
  printer, testOrder,
}: Props) {
  return (
    <aside
      className={`bg-[var(--color-surface)] border-r border-[var(--color-line)] hidden md:flex flex-col py-3 flex-shrink-0 z-30 transition-[width] duration-200 ease-in-out overflow-hidden ${
        expanded ? 'w-[220px]' : 'w-[60px]'
      }`}
    >
      {/* Logo + toggle */}
      <div className={`flex items-center mb-4 flex-shrink-0 ${expanded ? 'px-3 justify-between' : 'px-0 justify-center flex-col gap-3'}`}>
        <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-[var(--color-brand)] text-white shadow-sm">
          <Coffee className="w-5 h-5" />
        </div>
        {expanded && (
          <span className="text-[13px] font-semibold text-[var(--color-ink)] tracking-tight flex-1 ml-2 truncate">
            ZeloChat
          </span>
        )}
        <button
          onClick={onToggle}
          aria-label={expanded ? 'Recolher navegação' : 'Expandir navegação'}
          className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] transition-colors flex-shrink-0"
        >
          {expanded
            ? <PanelLeftClose className="w-4 h-4" strokeWidth={1.8} />
            : <PanelLeftOpen className="w-4 h-4" strokeWidth={1.8} />
          }
        </button>
      </div>

      {/* Primary nav */}
      <div className="px-2 flex-1 overflow-y-auto custom-scrollbar">
        {expanded && (
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)] px-1 mb-1.5">
            Operação
          </p>
        )}
        <nav className="flex flex-col gap-0.5">
          {primaryNavItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeView === item.id}
              expanded={expanded}
              badge={item.id === 'chat' ? (openEscalationCount > 0 ? openEscalationCount : unreadConversationsCount) : undefined}
              badgeTone={item.id === 'chat' && openEscalationCount > 0 ? 'alert' : 'unread'}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </nav>

        <div className="my-3 border-t border-[var(--color-line)]" />

        {expanded && (
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)] px-1 mb-1.5">
            Gestão
          </p>
        )}
        <nav className="flex flex-col gap-0.5">
          {secondaryNavItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeView === item.id}
              expanded={expanded}
              onClick={() => onNavigate(item.id)}
            />
          ))}
          {!isGeneralMode && (
            <a
              href="https://menu.zelopdv.com.br/admin"
              target="_blank"
              rel="noopener noreferrer"
              title={!expanded ? 'Cardápio' : undefined}
              className={`group relative w-full flex items-center rounded-[10px] transition-all text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] ${
                expanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-0 py-2.5'
              }`}
            >
              <ShoppingBag className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={1.8} />
              {expanded && (
                <div className="flex-1 text-left overflow-hidden">
                  <p className="text-[13.5px] font-medium leading-tight">Cardápio</p>
                  <p className="text-[11px] text-[var(--color-ink-faint)] truncate mt-[-1px]">Abrir ZeloMenu ↗</p>
                </div>
              )}
              {!expanded && (
                <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-md bg-[var(--color-ink)] px-2.5 py-1.5 text-[12px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  Cardápio
                </span>
              )}
            </a>
          )}
        </nav>
      </div>

      {/* Bottom: novidades + settings + printer + profile */}
      <div className="mt-auto px-2 flex flex-col gap-0.5 flex-shrink-0 pt-2 border-t border-[var(--color-line)]">
        <NavButton
          item={{ id: 'novidades', icon: Sparkles, label: 'Novidades', description: 'O que mudou no sistema' }}
          active={activeView === 'novidades'}
          expanded={expanded}
          onClick={() => onNavigate('novidades')}
        />
        <NavButton
          item={{ id: 'settings', icon: Settings, label: 'Configurações', description: 'Empresa e integrações' }}
          active={activeView === 'settings'}
          expanded={expanded}
          onClick={() => onNavigate('settings')}
        />
        {!isGeneralMode && (
          <PrinterButton
            printer={printer}
            expanded={expanded}
            testOrder={testOrder}
          />
        )}
        <button
          onClick={() => onNavigate('profile')}
          className={`w-full flex items-center rounded-[10px] transition-all ${
            expanded ? 'gap-3 px-3 py-2' : 'justify-center px-0 py-2'
          } ${
            activeView === 'profile'
              ? 'bg-[var(--color-brand-soft)]'
              : 'hover:bg-[var(--color-surface-muted)]'
          }`}
        >
          <img
            src={profileAvatar}
            alt={firstNameOnly}
            className="w-7 h-7 rounded-full object-cover flex-shrink-0 ring-1 ring-[var(--color-line)]"
          />
          {expanded && (
            <div className="flex-1 text-left overflow-hidden">
              <p className="text-[13px] font-medium leading-tight text-[var(--color-ink)] truncate">{firstNameOnly}</p>
              <p className="text-[11px] text-[var(--color-ink-faint)] truncate">{profileRole}</p>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
