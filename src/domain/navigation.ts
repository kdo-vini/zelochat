import type { LucideIcon } from 'lucide-react';
import {
  Bike,
  Bot,
  Calendar as CalendarIcon,
  Kanban,
  LayoutDashboard,
  MessageCircle,
  Settings,
  Sparkles,
  User,
} from 'lucide-react';

export type View =
  | 'dashboard'
  | 'chat'
  | 'customers'
  | 'kanban'
  | 'calendar'
  | 'ai-configs'
  | 'settings'
  | 'profile'
  | 'drivers'
  | 'novidades';

export type NavigationMode = 'restaurant' | 'general';
export type NavSection = 'primary' | 'secondary' | 'footer';
export type MobilePlacement = 'primary' | 'more' | 'hidden';

export interface NavItem {
  id: View;
  icon: LucideIcon;
  label: string;
  description: string;
  section: NavSection;
  restaurant: MobilePlacement;
  general: MobilePlacement;
  permission?: 'pessoas.visualizar';
  restaurantOnly?: boolean;
}

export interface NavigationPermissions {
  pessoas?: { visualizar?: boolean };
}

/** Fonte única: desktop and mobile placements live beside each destination. */
export const NAVIGATION: readonly NavItem[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Métricas', description: 'Métricas e alertas do dia', section: 'primary', restaurant: 'more', general: 'hidden', restaurantOnly: true },
  { id: 'chat', icon: MessageCircle, label: 'Atendimento', description: 'Conversas no WhatsApp', section: 'primary', restaurant: 'primary', general: 'primary' },
  { id: 'customers', icon: User, label: 'Clientes', description: 'Cadastro e relacionamento', section: 'primary', restaurant: 'primary', general: 'primary', permission: 'pessoas.visualizar' },
  { id: 'kanban', icon: Kanban, label: 'Produção', description: 'Fila de pedidos', section: 'primary', restaurant: 'primary', general: 'hidden', restaurantOnly: true },
  { id: 'drivers', icon: Bike, label: 'Motoboys', description: 'Entregadores', section: 'primary', restaurant: 'more', general: 'hidden', restaurantOnly: true },
  { id: 'calendar', icon: CalendarIcon, label: 'Agenda', description: 'Pedidos por data', section: 'secondary', restaurant: 'more', general: 'hidden', restaurantOnly: true },
  { id: 'ai-configs', icon: Bot, label: 'Cérebro IA', description: 'Configurar assistente', section: 'secondary', restaurant: 'more', general: 'more' },
  { id: 'novidades', icon: Sparkles, label: 'Novidades', description: 'O que mudou no sistema', section: 'footer', restaurant: 'more', general: 'more' },
  { id: 'settings', icon: Settings, label: 'Configurações', description: 'Empresa e integrações', section: 'footer', restaurant: 'more', general: 'more' },
  { id: 'profile', icon: User, label: 'Perfil', description: 'Sua conta', section: 'footer', restaurant: 'more', general: 'more' },
] as const;

function allowed(item: NavItem, permissions?: NavigationPermissions): boolean {
  if (!item.permission) return true;
  return permissions?.pessoas?.visualizar === true;
}

export function getDesktopNavigation(mode: NavigationMode, permissions?: NavigationPermissions): { primary: NavItem[]; secondary: NavItem[]; footer: NavItem[] } {
  const visible = NAVIGATION.filter((item) => !item.restaurantOnly || mode === 'restaurant').filter((item) => allowed(item, permissions));
  return {
    primary: visible.filter((item) => item.section === 'primary'),
    secondary: visible.filter((item) => item.section === 'secondary'),
    footer: visible.filter((item) => item.section === 'footer'),
  };
}

export function getMobileNavigation(mode: NavigationMode, permissions?: NavigationPermissions): { primary: NavItem[]; more: NavItem[]; moreActiveViews: Set<View> } {
  const placement = mode === 'restaurant' ? 'restaurant' : 'general';
  const visible = NAVIGATION.filter((item) => allowed(item, permissions) && (!item.restaurantOnly || mode === 'restaurant'));
  const primary = visible.filter((item) => item[placement] === 'primary');
  const more = visible.filter((item) => item[placement] === 'more');
  return { primary, more, moreActiveViews: new Set(more.map((item) => item.id)) };
}

export const GENERAL_ALLOWED_VIEWS = new Set<View>(
  NAVIGATION.filter((item) => item.general !== 'hidden' && !item.restaurantOnly).map((item) => item.id),
);
export const RESTAURANT_ONLY_VIEWS = new Set<View>(NAVIGATION.filter((item) => item.restaurantOnly).map((item) => item.id));
