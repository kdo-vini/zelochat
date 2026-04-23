import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ZeloState } from '../../types';

export const CalendarView = ({
  state,
  selectedDate,
  setSelectedDate,
  showDatePicker,
  setShowDatePicker,
}: {
  state: ZeloState;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  showDatePicker: boolean;
  setShowDatePicker: (s: boolean) => void;
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentMonth)),
    end: endOfWeek(endOfMonth(currentMonth)),
  });

  const blockedReason = state.blockedDates.find((item) => item.date === selectedDate)?.reason;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-8 py-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Agenda</h1>
          <p className="text-[13px] text-[var(--color-ink-muted)]">
            {format(parseISO(selectedDate), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="flex h-9 items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[13px] font-medium transition-colors hover:bg-[var(--color-surface-muted)]"
          >
            <CalendarIcon className="h-4 w-4 text-[var(--color-brand)]" />
            Selecionar data
          </button>

          <AnimatePresence>
            {showDatePicker && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-pop)]"
              >
                <div className="mb-4 flex items-center justify-between">
                  <button
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                    className="rounded-md p-1.5 transition-colors hover:bg-[var(--color-surface-muted)]"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-[13.5px] font-semibold capitalize">
                    {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
                  </span>
                  <button
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                    className="rounded-md p-1.5 transition-colors hover:bg-[var(--color-surface-muted)]"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="mb-1 grid grid-cols-7 gap-0.5">
                  {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((label) => (
                    <div
                      key={label}
                      className="py-1 text-center text-[11px] font-semibold text-[var(--color-ink-faint)]"
                    >
                      {label}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-0.5">
                  {days.map((day) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const isSelected = selectedDate === dateStr;
                    const isCurrentMonth = day.getMonth() === currentMonth.getMonth();

                    return (
                      <button
                        key={dateStr}
                        onClick={() => {
                          setSelectedDate(dateStr);
                          setShowDatePicker(false);
                        }}
                        className={`h-9 rounded-lg text-[12.5px] font-medium transition-colors ${
                          isSelected
                            ? 'bg-[var(--color-brand)] text-white'
                            : isCurrentMonth
                              ? 'hover:bg-[var(--color-surface-muted)]'
                              : 'text-[var(--color-ink-faint)]'
                        }`}
                      >
                        {format(day, 'd')}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-8 py-12">
        <div className="max-w-xl rounded-2xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-8 py-12 text-center">
          <CalendarIcon className="mx-auto mb-4 h-10 w-10 text-[var(--color-ink-faint)]" />
          <p className="text-[16px] font-semibold text-[var(--color-ink-soft)]">
            Agenda de pedidos indisponível por enquanto
          </p>
          <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">
            Nesta etapa os pedidos seguem somente via WhatsApp, então não há lançamentos reais nesta tela.
          </p>
          {blockedReason && (
            <p className="mt-4 text-[12px] font-medium text-[var(--color-alert)]">
              A data selecionada está bloqueada: {blockedReason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
