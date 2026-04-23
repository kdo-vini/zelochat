import { BusinessInfo } from '../../types/calendar';

// Returns true if the lanchonete is open at the given date/time
export function isOpenAt(now: Date, info: BusinessInfo): boolean {
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const hour = now.getHours();
  const minute = now.getMinutes();

  // Closed on Sundays (day 0)
  if (day === 0) return false;

  // Parse hours string "Segunda a Sábado, 9h às 18h" → use constants
  const openHour = 9;
  const closeHour = 18;
  const currentMinutes = hour * 60 + minute;

  return currentMinutes >= openHour * 60 && currentMinutes < closeHour * 60;
}

// Returns a human-readable "we are closed" context block for the AI prompt
export function buildClosedContextBlock(now: Date, info: BusinessInfo): string | null {
  if (isOpenAt(now, info)) return null;

  const day = now.getDay();
  const isSunday = day === 0;

  if (isSunday) {
    return `ATENÇÃO: HOJE É DOMINGO — ESTAMOS FECHADOS. Informe ao cliente que não abrimos aos domingos. Próxima abertura: segunda-feira às 9h.`;
  }

  const hour = now.getHours();
  const isBeforeOpen = hour < 9;

  if (isBeforeOpen) {
    return `ATENÇÃO: AINDA NÃO ABRIMOS. Horário de funcionamento: seg-sáb 9h às 18h. Informe o cliente que abriremos às 9h de hoje.`;
  }

  return `ATENÇÃO: JÁ ENCERRAMOS O ATENDIMENTO. Horário de funcionamento: seg-sáb 9h às 18h. Informe o cliente que abriremos amanhã às 9h (salvo domingo).`;
}
