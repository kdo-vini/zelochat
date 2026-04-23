import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ZeloState } from '../../types';
import { STATUS_LABELS, STATUS_COLORS } from '../../constants';

export const CalendarView = ({ state, selectedDate, setSelectedDate, showDatePicker, setShowDatePicker }: { 
  state: ZeloState, 
  selectedDate: string, 
  setSelectedDate: (d: string) => void, 
  showDatePicker: boolean, 
  setShowDatePicker: (s: boolean) => void 
}) => {
  const hours = Array.from({ length: 12 }, (_, i) => `${i + 9}:00`);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentMonth)),
    end: endOfWeek(endOfMonth(currentMonth)),
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col p-8 space-y-6 overflow-hidden relative">
      <header className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800 truncate mr-4">Agenda: {format(parseISO(selectedDate), "dd 'de' MMMM", { locale: ptBR })}</h2>
        <div className="flex gap-2 relative">
           <button 
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 text-sm font-medium hover:bg-gray-50 flex items-center gap-2"
           >
              <CalendarIcon className="w-4 h-4 text-[#00a884]" />
              Selecionar Data
           </button>
           
           <AnimatePresence>
            {showDatePicker && (
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute top-full right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 w-72 z-50 text-gray-800"
              >
                <div className="flex items-center justify-between mb-4">
                  <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1 hover:bg-gray-100 rounded-full"><ChevronLeft className="w-5 h-5" /></button>
                  <span className="font-bold text-sm">{format(currentMonth, "MMMM yyyy", { locale: ptBR })}</span>
                  <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1 hover:bg-gray-100 rounded-full"><ChevronRight className="w-5 h-5" /></button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => (
                    <div key={d} className="text-[10px] font-bold text-gray-400 text-center">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {days.map((day, i) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const ordersCount = state.orders.filter(o => o.pickupDate === dateStr).length;
                    const isSelected = selectedDate === dateStr;
                    const isCurrentMonth = day.getMonth() === currentMonth.getMonth();

                    return (
                      <button
                        key={i}
                        onClick={() => {
                          setSelectedDate(dateStr);
                          setShowDatePicker(false);
                        }}
                        className={`
                          h-9 rounded-lg flex flex-col items-center justify-center relative transition-all
                          ${isSelected ? 'bg-[#00a884] text-white' : 'hover:bg-gray-100'}
                          ${!isCurrentMonth && !isSelected ? 'text-gray-300' : 'text-gray-700'}
                        `}
                      >
                        <span className="text-xs font-semibold">{format(day, 'd')}</span>
                        {ordersCount > 0 && (
                          <span className={`text-[8px] font-bold ${isSelected ? 'text-white' : 'text-[#00a884]'}`}>
                            {ordersCount} {ordersCount === 1 ? 'ped' : 'peds'}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
           </AnimatePresence>

           <button className="flex items-center gap-2 bg-[#00a884] text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:shadow-md transition-shadow">
             <Plus className="w-4 h-4" /> Novo Pedido
           </button>
        </div>
      </header>

      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-y-auto custom-scrollbar relative">
        <div className="grid grid-cols-[100px_1fr] border-b border-gray-100 sticky top-0 bg-white z-10 shadow-sm">
           <div className="p-4 border-r border-gray-100 font-bold text-gray-400 text-xs text-center">HORÁRIO</div>
           <div className="p-4 font-bold text-gray-400 text-xs">PEDIDOS AGENDADOS</div>
        </div>
        {hours.map(hour => {
          const orders = state.orders.filter(o => o.pickupDate === selectedDate && o.pickupTime.startsWith(hour.split(':')[0]));
          const isBlocked = state.blockedDates.some(bd => bd.date === selectedDate);
          
          return (
            <div key={hour} className="grid grid-cols-[100px_1fr] min-h-[120px] border-b border-gray-50 relative group">
              <div className="p-4 border-r border-gray-50 text-xs font-bold text-gray-500 bg-gray-50/30 flex flex-col items-center justify-start py-6">
                {hour}
                <span className="text-[10px] opacity-30 font-normal">ZeloChat</span>
              </div>
              <div className="p-3 relative flex flex-wrap gap-4 content-start">
                {orders.map(order => (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    key={order.id} 
                    className="min-w-[240px] max-w-[300px] bg-[#dcf8c6]/30 border-l-4 border-[#00a884] p-3 rounded-lg shadow-sm text-xs hover:shadow-md transition-all cursor-pointer border border-gray-100"
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-gray-800">{order.customerName}</span>
                      <span className="font-mono bg-white px-1.5 rounded border border-gray-100">{order.pickupTime}</span>
                    </div>
                    <p className="text-[10px] text-gray-600 line-clamp-2 italic mb-2">
                      {order.items.map(i => `${i.quantity}x ${i.product}`).join(', ')}
                    </p>
                    <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider">
                      <span className={`${STATUS_COLORS[order.status]?.split(' ')[1] || 'text-[#00a884]'}`}>
                        {STATUS_LABELS[order.status] || order.status}
                      </span>
                      <span className="text-gray-400">R$ {order.total.toFixed(2)}</span>
                    </div>
                  </motion.div>
                ))}
                {isBlocked && (
                  <div className="absolute inset-0 bg-red-100/10 backdrop-blur-[1px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <span className="bg-red-500 text-white text-[10px] px-3 py-1 rounded-full font-bold shadow-lg">DATA BLOQUEADA</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
