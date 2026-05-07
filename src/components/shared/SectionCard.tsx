import React from 'react';
import { Clock } from 'lucide-react';

/**
 * Standard surface for a settings/profile section. Icon + title in a thin
 * header, content below. Used across SettingsView, ProfileView, and any other
 * settings-style surface so the visual rhythm stays consistent.
 */
export const SectionCard = ({ icon: Icon, title, children }: {
  icon: typeof Clock;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
    <div className="flex items-center gap-2 px-5 py-4 border-b border-[var(--color-line)]">
      <Icon className="w-4 h-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
      <h3 className="text-[14px] font-semibold">{title}</h3>
    </div>
    <div className="p-5">{children}</div>
  </div>
);
