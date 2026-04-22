import { BlockedDate } from '../../types/calendar';

export function isDateBlocked(date: string, blockedDates: BlockedDate[]): BlockedDate | null {
  return blockedDates.find(bd => bd.date === date) ?? null;
}

export function formatBlockedDatesForPrompt(blockedDates: BlockedDate[]): string {
  if (blockedDates.length === 0) return 'Nenhuma data bloqueada no momento.';
  return blockedDates.map(bd => `${bd.date} (Motivo: ${bd.reason})`).join(', ');
}
