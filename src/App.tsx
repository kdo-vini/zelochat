/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageCircle, Settings, Send, User, Coffee, Calendar as CalendarIcon, Package, Check, 
  Search, MoreVertical, Phone, Video, Smile, Paperclip, Bot, UserCheck, 
  LayoutDashboard, Kanban, ShieldCheck, Clock, Plus, Filter, MoreHorizontal,
  ChevronLeft, ChevronRight, Bell, Moon, Sun, Camera, LogOut, Bike, MapPin
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ZeloState, ChatMessage, ChatSession, Order, Product, DeliveryDriver } from './types';
import { INITIAL_STATE, STATUS_LABELS, STATUS_COLORS } from './constants';
import { getClientResponse, getOwnerResponse } from './services/geminiService';

type View = 'dashboard' | 'chat' | 'kanban' | 'calendar' | 'ai-configs' | 'settings' | 'profile' | 'drivers';

// --- Sub-View Components ---

const DashboardView = ({ state, setActiveView }: { state: ZeloState, setActiveView: (v: View) => void }) => (
  <div className="flex-1 min-h-0 overflow-y-auto p-8 space-y-8 relative pb-32">
    <header className="flex justify-between items-center">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Visão Geral</h2>
        <p className="text-sm text-gray-500">Bem-vinda de volta, Dona de ZeloChat!</p>
      </div>
      <div className="flex gap-2">
        <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-100 flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full" />
          <span className="text-xs font-semibold">Sistema Online</span>
        </div>
      </div>
    </header>

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {[
        { label: 'Pedidos Hoje', value: state.orders.filter(o => o.pickupDate === '2026-04-23').length, icon: Package, color: 'text-blue-600', bg: 'bg-blue-100' },
        { label: 'Chats Ativos', value: state.sessions.length, icon: MessageCircle, color: 'text-green-600', bg: 'bg-green-100' },
        { label: 'A faturar hoje', value: `R$ ${state.orders.reduce((acc, o) => acc + o.total, 0).toFixed(2)}`, icon: Coffee, color: 'text-orange-600', bg: 'bg-orange-100' },
        { label: 'IA Intervenções', value: '142', icon: Bot, color: 'text-purple-600', bg: 'bg-purple-100' },
      ].map((stat, i) => (
        <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className={`${stat.bg} ${stat.color} p-3 rounded-xl`}><stat.icon className="w-6 h-6" /></div>
          <div>
            <p className="text-xs text-gray-400 font-medium">{stat.label}</p>
            <p className="text-xl font-bold text-gray-800">{stat.value}</p>
          </div>
        </div>
      ))}
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h3 className="font-bold text-gray-800 mb-4">Últimos Pedidos</h3>
        <div className="space-y-4">
          {state.orders.slice(0, 3).map(order => (
            <div key={order.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center font-bold text-gray-500">{order.customerName[0]}</div>
                <div>
                  <p className="text-sm font-semibold">{order.customerName}</p>
                  <p className="text-[10px] text-gray-400 truncate max-w-[150px]">
                    {order.items.map(i => `${i.quantity}x ${i.product}`).join(', ')}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold">R$ {order.total.toFixed(2)}</p>
                <span className={`text-[9px] px-2 py-0.5 rounded-full uppercase font-bold shadow-sm ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABELS[order.status] || order.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-[#00a884] p-6 rounded-2xl shadow-lg relative overflow-hidden text-white">
        <Bot className="absolute -right-4 -bottom-4 w-32 h-32 opacity-10" />
        <h3 className="font-bold text-lg mb-2">Desempenho da IA</h3>
        <p className="text-sm opacity-90 mb-4">A IA resolveu 92% das dúvidas sem intervenção manual nas últimas 24h.</p>
        <div className="w-full bg-white/20 h-2 rounded-full mb-4">
          <div className="bg-white w-[92%] h-full rounded-full" />
        </div>
        <button className="bg-white text-[#00a884] text-xs font-bold px-4 py-2 rounded-lg" onClick={() => setActiveView('ai-configs')}>Ajustar Cérebro</button>
      </div>
    </div>
  </div>
);

const KanbanView = ({ state, onDragEnd, setActiveView }: { state: ZeloState, onDragEnd: (r: DropResult) => void, setActiveView: (v: View) => void }) => {
  const columns: Order['status'][] = ['pending', 'preparing', 'ready', 'delivered'];
  
  return (
    <div className="flex-1 min-h-0 flex flex-col p-8 space-y-6 relative">
      <header className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Fluxo de Pedidos (Kanban)</h2>
      </header>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex-1 flex gap-6 overflow-x-auto pb-4 custom-scrollbar">
          {columns.map(col => (
            <Droppable key={col} droppableId={col}>
              {(provided) => (
                <div 
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="w-80 flex-shrink-0 flex flex-col h-full bg-gray-100/50 rounded-2xl border border-gray-200"
                >
                  <div className="p-4 flex justify-between items-center bg-white border-b border-gray-200 rounded-t-2xl">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">{STATUS_LABELS[col]}</h3>
                    <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-2 py-1 rounded-full">{state.orders.filter(o => o.status === col).length}</span>
                  </div>
                  <div className="flex-1 p-3 space-y-3 overflow-y-auto custom-scrollbar">
                    {state.orders.filter(o => o.status === col).map((order, index) => (
                      <Draggable key={order.id} draggableId={order.id} index={index}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 cursor-pointer hover:border-[#00a884] transition-colors relative"
                          >
                            <div className="flex justify-between items-start mb-2">
                              <p className="text-sm font-bold text-gray-800">{order.customerName}</p>
                              
                              <div className="relative group">
                                <MoreHorizontal className="w-4 h-4 text-gray-400 cursor-pointer hover:text-gray-600" />
                                <div className="absolute right-0 top-5 bg-white shadow-xl border border-gray-100 rounded-lg p-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50 min-w-[140px]">
                                  {col === 'ready' ? (
                                    <button 
                                      onClick={() => setActiveView('drivers')}
                                      className="w-full text-left px-3 py-2 text-xs font-bold text-orange-600 hover:bg-orange-50 rounded-md flex items-center gap-2"
                                    >
                                      <Bike className="w-3 h-3" /> Despachar Moto
                                    </button>
                                  ) : (
                                    <button className="w-full text-left px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded-md">
                                      Ver Detalhes
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="space-y-1 mb-3">
                              {order.items.map((item, idx) => (
                                <p key={idx} className="text-[11px] text-gray-500 flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 bg-[#00a884] rounded-full" />
                                  {item.quantity}x {item.product}
                                </p>
                              ))}
                            </div>
                            <div className="flex justify-between items-center pt-3 border-t border-gray-50 mt-2">
                              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                                <Clock className="w-3 h-3" /> {order.pickupTime}
                              </div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>
    </div>
  );
};

const CalendarView = ({ state, selectedDate, setSelectedDate, showDatePicker, setShowDatePicker }: { 
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
          const isBlocked = state.blockedDates.includes(selectedDate);
          
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

const AIConfigsView = ({ state, setState }: { state: ZeloState, setState: React.Dispatch<React.SetStateAction<ZeloState>> }) => {
  const [managerInput, setManagerInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcessContext = async () => {
    if (!managerInput.trim()) return;
    setIsProcessing(true);
    try {
      const newRules = await getOwnerResponse(managerInput);
      const newContexts = newRules.map(text => ({ id: Date.now().toString() + Math.random(), text }));
      setState(prev => ({
        ...prev,
        dailyContext: [...(prev.dailyContext || []), ...newContexts]
      }));
      setManagerInput('');
    } catch(e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const [managerChatInput, setManagerChatInput] = useState('');
  const handleGeneralManagerSend = async () => {
    if (!managerChatInput.trim()) return;
    
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: managerChatInput, timestamp: new Date().toISOString() };
    
    setState(prev => ({
      ...prev,
      managerHistory: [...(prev.managerHistory || []), userMsg]
    }));
    
    setManagerChatInput('');
    setIsProcessing(true);
    
    try {
      // Must use a fresh un-updated history if react update is pending, so build it manually
      const currentHistory = [...(state.managerHistory || []), userMsg];
      const result = await getGeneralManagerResponse(currentHistory, userMsg.content);
      
      const botMsg: ChatMessage = { id: Date.now().toString(), role: 'assistant', content: result.reply, timestamp: new Date().toISOString() };
      
      setState(prev => {
        let newState = { ...prev, managerHistory: [...(prev.managerHistory || []), botMsg] };
        
        if (result.actions && result.actions.length > 0) {
          result.actions.forEach((action: any) => {
             if (action.type === 'BLOCK_DATE') {
               // Assuming payload is { date, reason }
               newState.blockedDates = [...newState.blockedDates, action.payload];
             }
          });
        }
        
        return newState;
      });
      
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-8 pb-32 space-y-6 custom-scrollbar relative">
      <header className="mb-2">
        <h2 className="text-2xl font-bold text-gray-800">Cérebro do ZeloChat (IA)</h2>
        <p className="text-sm text-gray-500">Gestão compacta do Agente de Atendimento e regras dinâmicas.</p>
      </header>

      {/* TOP ROW: THE TWO AIs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* AI 1: Daily Context */}
        <div className="bg-white rounded-2xl shadow-sm border border-orange-100 flex flex-col h-[280px] overflow-hidden">
          <div className="bg-orange-50/50 p-4 border-b border-orange-100 flex items-center justify-between">
             <div className="flex items-center gap-2">
               <div className="bg-orange-100 p-1.5 rounded-lg text-orange-600"><Clock className="w-4 h-4" /></div>
               <h3 className="font-bold text-gray-800 text-sm">Gestão Diária (Avisos de Hoje)</h3>
             </div>
             {state.dailyContext && state.dailyContext.length > 0 && (
                <button 
                   onClick={() => setState(prev => ({ ...prev, dailyContext: [] }))}
                   className="text-[10px] bg-red-50 text-red-600 hover:bg-red-100 px-2 py-1 rounded-md font-bold transition-colors"
                >
                  Limpar Todos
                </button>
             )}
          </div>
          
          <div className="p-4 flex-1 overflow-y-auto custom-scrollbar bg-gray-50/30">
            {(!state.dailyContext || state.dailyContext.length === 0) ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
                 <Moon className="w-6 h-6 mb-2" />
                 <p className="text-xs italic text-center">Nenhuma regra ativa para hoje.<br/>A lanchonete opera normalmente.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {state.dailyContext.map((ctx) => (
                  <div key={ctx.id} className="flex gap-2 items-center bg-white border border-gray-100 p-2 rounded-xl group hover:border-orange-200 transition-colors shadow-sm">
                    <span className="w-1.5 h-1.5 bg-orange-500 rounded-full flex-shrink-0" />
                    <input 
                      type="text" 
                      value={ctx.text}
                      onChange={(e) => setState(prev => ({ ...prev, dailyContext: prev.dailyContext.map(c => c.id === ctx.id ? { ...c, text: e.target.value } : c) }))}
                      className="flex-1 bg-transparent outline-none text-xs text-gray-700 font-medium"
                    />
                    <button 
                      onClick={() => setState(prev => ({ ...prev, dailyContext: prev.dailyContext.filter(c => c.id !== ctx.id) }))}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 rounded-md transition-all"
                    >
                      <Plus className="w-3 h-3 rotate-45" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="p-3 bg-white border-t border-gray-100">
            <div className="flex gap-2 relative">
              <input
                value={managerInput}
                onChange={(e) => setManagerInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleProcessContext()}
                placeholder="Ex: Acabou coxinha..."
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-orange-400"
              />
              <button 
                onClick={handleProcessContext}
                disabled={isProcessing || !managerInput.trim()}
                className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white px-3 py-2 rounded-xl shadow-md transition-colors flex items-center justify-center"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* AI 2: General Manager Chat */}
        <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 flex flex-col h-[280px] overflow-hidden">
          <div className="bg-indigo-50/50 p-4 border-b border-indigo-100 flex items-center gap-2">
             <div className="bg-indigo-100 p-1.5 rounded-lg text-indigo-600"><Bot className="w-4 h-4" /></div>
             <div>
               <h3 className="font-bold text-gray-800 text-sm">Gestão Geral (Calendário & Setup)</h3>
               <p className="text-[9px] text-gray-500 -mt-0.5">Bloqueios de dias e horários a longo prazo</p>
             </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-gray-50/30">
             {state.managerHistory.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`text-xs px-3 py-2 rounded-xl max-w-[85%] ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none shadow-sm' : 'bg-white border border-gray-100 text-gray-800 rounded-bl-none shadow-sm'}`}>
                     {msg.content}
                  </div>
                </div>
             ))}
             {state.managerHistory.length === 0 && (
               <div className="h-full flex items-center justify-center text-gray-400 opacity-60">
                 <p className="text-xs italic text-center">Fale com a IA. Ex:<br/>"Não vamos abrir final de semana."</p>
               </div>
             )}
             {isProcessing && <div className="text-xs text-indigo-400 italic text-left">IA digitando...</div>}
           </div>
           
           <div className="p-3 bg-white border-t border-gray-100">
              <div className="flex gap-2 relative">
                <input 
                   type="text" 
                   value={managerChatInput}
                   onChange={e => setManagerChatInput(e.target.value)}
                   onKeyDown={e => e.key === 'Enter' && handleGeneralManagerSend()}
                   className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-indigo-400"
                   placeholder="Pedir para a IA..."
                />
                <button 
                   onClick={handleGeneralManagerSend}
                   disabled={isProcessing || !managerChatInput.trim()}
                   className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-xl shadow-md disabled:opacity-50 transition-all flex items-center justify-center"
                >
                   <Send className="w-3 h-3" />
                </button>
             </div>
           </div>
        </div>

      </div>

      {/* MIDDLE ROW: Macros and Triggers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Macros */}
        <div className="lg:col-span-2 bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col h-[260px]">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2"><Send className="w-4 h-4 text-green-600" /> Respostas Rápidas (Macros)</h3>
            <button 
              onClick={() => {
                const newQr = { id: Date.now().toString(), trigger: '', response: '' };
                setState(prev => ({ ...prev, quickResponses: [newQr, ...prev.quickResponses] }));
              }}
              className="px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Adicionar
            </button>
          </div>
          
          <div className="overflow-y-auto flex-1 custom-scrollbar space-y-2 pr-2">
            {state.quickResponses.map((qr) => (
              <div key={qr.id} className="flex gap-3 bg-gray-50 p-2 rounded-xl border border-gray-100 relative group">
                  <div className="w-24">
                    <input 
                      type="text" 
                      value={qr.trigger} 
                      onChange={(e) => setState(prev => ({
                        ...prev, quickResponses: prev.quickResponses.map(q => q.id === qr.id ? { ...q, trigger: e.target.value.toUpperCase() } : q)
                      }))}
                      className="w-full bg-white border border-gray-200 rounded-md px-2 py-1 text-xs font-bold focus:ring-1 focus:ring-green-400 outline-none uppercase" 
                      placeholder="Gatilho"
                    />
                  </div>
                  <div className="flex-1 relative">
                    <input 
                      type="text"
                      value={qr.response} 
                      onChange={(e) => setState(prev => ({
                        ...prev, quickResponses: prev.quickResponses.map(q => q.id === qr.id ? { ...q, response: e.target.value } : q)
                      }))}
                      className="w-full bg-white border border-gray-200 rounded-md px-2 py-1 text-xs focus:ring-1 focus:ring-green-400 outline-none pr-8" 
                      placeholder="Texto da resposta..."
                    />
                    <button 
                      onClick={() => setState(prev => ({ ...prev, quickResponses: prev.quickResponses.filter(q => q.id !== qr.id) }))}
                      className="absolute right-1 top-1 bottom-1 px-1.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 hover:bg-red-50 rounded transition-all flex items-center justify-center"
                    >
                      <Plus className="w-3 h-3 rotate-45" />
                    </button>
                  </div>
              </div>
            ))}
            {state.quickResponses.length === 0 && (
              <p className="text-xs text-center text-gray-400 mt-6">Nenhum macro configurado.</p>
            )}
          </div>
        </div>

        {/* Triggers */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col h-[260px]">
            <h3 className="font-bold text-gray-800 text-sm mb-4 flex items-center gap-2"><Bell className="w-4 h-4 text-purple-600" /> Gatilhos Silenciosos</h3>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
              {state.alertTriggers?.map(t => (
                <label key={t.id} className="flex items-start gap-3 p-3 bg-gray-50 border border-gray-100 rounded-xl cursor-pointer hover:border-purple-200 transition-colors">
                  <div className="mt-0.5">
                    <input 
                      type="checkbox" 
                      checked={t.active} 
                      onChange={(e) => setState(prev => ({
                        ...prev, alertTriggers: prev.alertTriggers.map(at => at.id === t.id ? { ...at, active: e.target.checked } : at)
                      }))}
                      className="w-4 h-4 accent-purple-600 cursor-pointer" 
                    />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-gray-700 block">{t.name}</span>
                    <span className="text-[10px] text-gray-500">Avisa no chat se acontecer.</span>
                  </div>
                </label>
              ))}
            </div>
        </div>

      </div>

      {/* BOTTOM ROW: System Prompt */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 relative group">
        <div className="absolute top-6 right-6">
          <button className="bg-purple-50 text-purple-600 hover:bg-purple-100 px-4 py-1.5 rounded-lg font-bold text-xs transition-colors">Modificar Prompt</button>
        </div>
        <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-2 text-sm"><Settings className="w-4 h-4 text-gray-500" /> Instruções Base do Agente</h3>
        <p className="text-xs text-gray-500 mb-4 pr-32">O prompt mestre contendo personalidade e diretrizes absolutas. Alterar isso muda a "alma" da IA.</p>
        
        <textarea 
          className="w-full h-28 bg-gray-50 rounded-xl p-4 text-[11px] border border-gray-200 outline-none focus:ring-1 focus:ring-purple-400 font-mono resize-none text-gray-600 leading-relaxed"
          defaultValue={state.aiInstructions}
          onChange={(e) => setState(prev => ({ ...prev, aiInstructions: e.target.value }))}
        />
      </div>

    </div>
  );
};

const SettingsView = ({ state, setState }: { state: ZeloState, setState: React.Dispatch<React.SetStateAction<ZeloState>> }) => (
  <div className="flex-1 min-h-0 overflow-y-auto p-8 pb-32 space-y-8 custom-scrollbar relative">
    <header>
      <h2 className="text-2xl font-bold text-gray-800">Configurações do Sistema</h2>
      <p className="text-sm text-gray-500">Gerencie informações da empresa, horários e preferências globais.</p>
    </header>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 font-sans"><Coffee className="w-5 h-5 text-orange-600" /> Dados da Empresa</h3>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Nome da Lanchonete</label>
              <input 
                type="text" 
                value={state.businessInfo.name}
                onChange={(e) => setState(prev => ({ ...prev, businessInfo: { ...prev.businessInfo, name: e.target.value } }))}
                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Endereço de Retirada</label>
              <input 
                type="text" 
                value={state.businessInfo.address}
                onChange={(e) => setState(prev => ({ ...prev, businessInfo: { ...prev.businessInfo, address: e.target.value } }))}
                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400" 
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Telefone de Contato</label>
                <input 
                  type="text" 
                  value={state.businessInfo.phone}
                  onChange={(e) => setState(prev => ({ ...prev, businessInfo: { ...prev.businessInfo, phone: e.target.value } }))}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400" 
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Chave PIX (CNPJ/CPF)</label>
                <input 
                  type="text" 
                  value={state.businessInfo.pixKey}
                  onChange={(e) => setState(prev => ({ ...prev, businessInfo: { ...prev.businessInfo, pixKey: e.target.value } }))}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400" 
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 font-sans"><Clock className="w-5 h-5 text-blue-600" /> Horários e Atendimento</h3>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Horário de Funcionamento</label>
              <input 
                type="text" 
                value={state.businessInfo.hours}
                onChange={(e) => setState(prev => ({ ...prev, businessInfo: { ...prev.businessInfo, hours: e.target.value } }))}
                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Dias de Fechamento</label>
              <div className="flex gap-2 flex-wrap mt-2">
                {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(day => (
                   <button 
                    key={day}
                    onClick={() => {
                        const isClosed = state.businessInfo.closedDays.includes(day);
                        setState(prev => ({
                            ...prev,
                            businessInfo: {
                                ...prev.businessInfo,
                                closedDays: isClosed 
                                    ? prev.businessInfo.closedDays.filter(d => d !== day)
                                    : [...prev.businessInfo.closedDays, day]
                            }
                        }))
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${state.businessInfo.closedDays.includes(day) ? 'bg-red-500 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                   >
                     {day}
                   </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 font-sans"><Bell className="w-5 h-5 text-purple-600" /> Preferências de Notificação</h3>
          <div className="space-y-4">
            {[
              { label: 'Som para novas mensagens', enabled: true },
              { label: 'Notificar pedidos acima de R$ 200', enabled: true },
              { label: 'Relatório diário por e-mail', enabled: false },
              { label: 'Alertar quando estoque acabar', enabled: true },
            ].map((opt, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{opt.label}</span>
                <div className={`w-10 h-5 rounded-full relative transition-colors cursor-pointer ${opt.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${opt.enabled ? 'right-1' : 'left-1'}`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#121b21] p-6 rounded-2xl text-white shadow-lg">
           <h3 className="font-bold mb-4 flex items-center gap-2 font-sans"><ShieldCheck className="w-5 h-5 text-green-500" /> Segurança</h3>
           <p className="text-xs opacity-70 mb-4">Seus dados de faturamento e clientes são protegidos por criptografia de ponta a ponta conforme o padrão WhatsApp.</p>
           <button className="w-full bg-white/10 hover:bg-white/20 py-2.5 rounded-xl text-xs font-bold transition-colors">Exportar Backup de Dados</button>
        </div>
      </div>
    </div>
  </div>
);

const ProfileView = ({ state, setState }: { state: ZeloState, setState: React.Dispatch<React.SetStateAction<ZeloState>> }) => (
  <div className="flex-1 min-h-0 overflow-y-auto p-8 pb-32 flex flex-col items-center justify-start space-y-8 custom-scrollbar">
     <div className="w-full max-w-2xl space-y-8">
        <header className="flex flex-col items-center text-center space-y-4">
           <div className="relative group">
              <div className="w-32 h-32 rounded-full border-4 border-[#00a884] p-1 shadow-2xl bg-white overflow-hidden">
                <img src={state.profile.avatar} alt="Avatar" className="w-full h-full rounded-full object-cover" />
              </div>
              <button className="absolute bottom-0 right-0 p-2 bg-[#00a884] text-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-4 h-4" />
              </button>
           </div>
           <div>
              <h2 className="text-2xl font-bold text-gray-800">{state.profile.name}</h2>
              <p className="text-sm text-gray-500 flex items-center justify-center gap-2">
                <Check className="w-4 h-4 text-[#00a884]" /> {state.profile.role} • ZeloChat verificado
              </p>
           </div>
        </header>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                 <label className="text-[10px] font-bold text-gray-400 uppercase">Nome Completo</label>
                 <input 
                    type="text" 
                    value={state.profile.name}
                    onChange={(e) => setState(prev => ({ ...prev, profile: { ...prev.profile, name: e.target.value } }))}
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884]" 
                 />
              </div>
              <div>
                 <label className="text-[10px] font-bold text-gray-400 uppercase">E-mail Administrativo</label>
                 <input 
                    type="email" 
                    value={state.profile.email}
                    onChange={(e) => setState(prev => ({ ...prev, profile: { ...prev.profile, email: e.target.value } }))}
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884]" 
                 />
              </div>
           </div>

           <div className="space-y-4">
              <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider">Ações de Conta</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <button className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded-xl border border-gray-100 hover:border-blue-400 transition-all gap-2 group">
                    <ShieldCheck className="w-6 h-6 text-blue-500" />
                    <span className="text-[10px] font-bold text-gray-600">Alterar Senha</span>
                 </button>
                 <button className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded-xl border border-gray-100 hover:border-orange-400 transition-all gap-2 group">
                    <LogOut className="w-6 h-6 text-orange-500" />
                    <span className="text-[10px] font-bold text-gray-600">Sair em outros disp.</span>
                 </button>
                 <button className="flex flex-col items-center justify-center p-4 bg-red-50 rounded-xl border border-red-100 hover:bg-red-100 transition-all gap-2 group">
                    <LogOut className="w-6 h-6 text-red-600" />
                    <span className="text-[10px] font-bold text-red-600">Encerrar Sessão</span>
                 </button>
              </div>
           </div>
        </div>

        <div className="flex justify-center gap-4 text-[10px] text-gray-400">
           <a href="#" className="hover:text-gray-600 transition-colors">Termos de Uso</a>
           <span>•</span>
           <a href="#" className="hover:text-gray-600 transition-colors">Política de Privacidade</a>
           <span>•</span>
           <span>Versão 1.4.2-beta</span>
        </div>
     </div>
  </div>
);

const DriversView = ({ state, setState }: { state: ZeloState, setState: React.Dispatch<React.SetStateAction<ZeloState>> }) => {
  const [newDriver, setNewDriver] = useState({ name: '', phone: '' });

  const handleAddDriver = () => {
    if (!newDriver.name || !newDriver.phone) return;
    setState(prev => ({
      ...prev,
      drivers: [...prev.drivers, {
        id: Date.now().toString(),
        name: newDriver.name,
        phone: newDriver.phone.replace(/\D/g, ''),
        status: 'available'
      }]
    }));
    setNewDriver({ name: '', phone: '' });
  };

  const notifyDriver = (driver: DeliveryDriver, order?: Order) => {
    let message = `Olá ${driver.name}, temos uma nova corrida para você!`;
    if (order && order.deliveryAddress) {
      message = `Olá ${driver.name}! Nova entrega!\n\nCliente: ${order.customerName}\nEndereço: ${order.deliveryAddress}\nTotal: R$ ${order.total.toFixed(2)}`;
    }
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${driver.phone}?text=${encoded}`, '_blank');
  };

  const pendingDeliveries = state.orders.filter(o => o.status === 'ready');

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-8 pb-32 space-y-8 custom-scrollbar relative">
      <header>
        <h2 className="text-2xl font-bold text-gray-800">Controle de Motoboys</h2>
        <p className="text-sm text-gray-500">Cadastre entregadores e despache pedidos via WhatsApp.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
             <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-orange-500" /> Cadastrar Motoboy</h3>
             <div className="space-y-4">
                <div>
                   <label className="text-[10px] font-bold text-gray-400 uppercase">Nome do Entregador</label>
                   <input 
                      type="text" 
                      value={newDriver.name}
                      onChange={(e) => setNewDriver(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400" 
                      placeholder="Ex: Tio Patinhas"
                   />
                </div>
                <div>
                   <label className="text-[10px] font-bold text-gray-400 uppercase">WhatsApp (Apenas Números)</label>
                   <input 
                      type="text" 
                      value={newDriver.phone}
                      onChange={(e) => setNewDriver(prev => ({ ...prev, phone: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400 font-mono" 
                      placeholder="Ex: 5511999999999"
                   />
                </div>
                <button 
                  onClick={handleAddDriver}
                  disabled={!newDriver.name || !newDriver.phone}
                  className="w-full bg-orange-500 text-white rounded-xl py-2.5 text-sm font-bold shadow-md hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  Adicionar Entregador
                </button>
             </div>
          </div>

          <div className="bg-[#121b21] p-6 rounded-2xl text-white shadow-lg">
             <h3 className="font-bold mb-4 flex items-center gap-2"><MapPin className="w-5 h-5 text-green-500" /> Central de Despacho</h3>
             <p className="text-xs opacity-70 mb-4">Pedidos prontos aguardando motoboy ({pendingDeliveries.length})</p>
             <div className="space-y-3">
               {pendingDeliveries.length === 0 && <p className="text-xs text-gray-400 italic">Nenhum pedido para entrega esperando no momento.</p>}
               {pendingDeliveries.map(order => (
                  <div key={order.id} className="bg-white/10 p-3 rounded-xl border border-white/5">
                     <p className="text-xs font-bold">{order.customerName}</p>
                     <p className="text-[10px] text-gray-400 truncate mb-2">{order.deliveryAddress || 'Retirada no local / Endereço não informado'}</p>
                     
                     <div className="flex gap-2">
                       <select 
                          className="bg-black/20 border border-white/10 rounded-lg outline-none text-[10px] px-2 py-1 flex-1"
                          onChange={(e) => {
                             const driver = state.drivers.find(d => d.id === e.target.value);
                             if (driver) notifyDriver(driver, order);
                          }}
                          defaultValue=""
                       >
                         <option value="" disabled>Chamar Motoboy...</option>
                         {state.drivers.map(d => (
                            <option key={d.id} value={d.id}>{d.name} ({d.status})</option>
                         ))}
                       </select>
                     </div>
                  </div>
               ))}
             </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
           <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2"><Bike className="w-5 h-5 text-orange-500" /> Entregadores Ativos</h3>
           
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {state.drivers.map(driver => (
                <div key={driver.id} className="p-5 border border-gray-100 bg-gray-50 rounded-2xl flex flex-col justify-between hover:shadow-md transition-shadow">
                   <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                         <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center font-bold">
                            <Bike className="w-5 h-5" />
                         </div>
                         <div>
                           <h4 className="font-bold text-gray-800 text-sm">{driver.name}</h4>
                           <p className="text-xs text-gray-500 font-mono">+{driver.phone}</p>
                         </div>
                      </div>
                      <span className={`w-3 h-3 rounded-full ${driver.status === 'available' ? 'bg-green-500' : driver.status === 'busy' ? 'bg-orange-500' : 'bg-gray-400'}`} title={driver.status} />
                   </div>
                   
                   <div className="flex items-center gap-2 mt-auto">
                      <button 
                         onClick={() => notifyDriver(driver)}
                         className="flex-1 bg-[#25d366] hover:bg-[#20bd5a] text-white py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2"
                      >
                         <MessageCircle className="w-4 h-4" /> Alerta Geral
                      </button>
                      <button 
                         onClick={() => setState(prev => ({ ...prev, drivers: prev.drivers.filter(d => d.id !== driver.id) }))}
                         className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl transition-colors"
                      >
                         Remover
                      </button>
                   </div>
                </div>
             ))}
           </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [activeView, setActiveView] = useState<View>('chat');
  const [state, setState] = useState<ZeloState>(INITIAL_STATE);
  const [activeSessionId, setActiveSessionId] = useState<string>(INITIAL_STATE.sessions[0].id);
  const [ownerInput, setOwnerInput] = useState('');
  const [isTyping, setIsTyping] = useState<Record<string, boolean>>({});
  const [selectedDate, setSelectedDate] = useState('2026-04-23');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeView === 'chat') {
      scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
    }
  }, [state.sessions, activeSessionId, activeView]);

  const activeSession = state.sessions.find(s => s.id === activeSessionId) || state.sessions[0];

  // AI Logic
  const triggerAIReply = async (sessionId: string, userText: string) => {
    setIsTyping(prev => ({ ...prev, [sessionId]: true }));
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // We must pass the MOST recent state to the AI, but since we are inside a promise/async, 
    // it's okay to just use the `state` from closure here if it's well updated, but ideally, React state can be tricky.
    // Assuming `state` is reasonably fresh for this demo.
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return;
    
    let botResponse = await getClientResponse(state, session.messages, userText);
    
    // Check for alerts
    const detectedAlerts: string[] = [];
    const alertRegex = /<ALERT>(.*?)<\/ALERT>/g;
    let match;
    while ((match = alertRegex.exec(botResponse)) !== null) {
      detectedAlerts.push(match[1]);
    }
    
    // Strip alerts from the display string
    botResponse = botResponse.replace(/<ALERT>(.*?)<\/ALERT>/g, '').trim();

    const botMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: botResponse,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    setState(prev => {
      const updatedSessions = prev.sessions.map(s => {
        if (s.id === sessionId) {
          return {
            ...s,
            messages: [...s.messages, botMsg],
            lastMessage: botMsg.content,
            lastMessageTime: botMsg.timestamp,
            unreadCount: activeSessionId === sessionId ? 0 : s.unreadCount,
            alerts: [...(s.alerts || []), ...detectedAlerts] // Keep existing and add newly detected alerts
          };
        }
        return s;
      });
      return { ...prev, sessions: updatedSessions };
    });
    
    setIsTyping(prev => ({ ...prev, [sessionId]: false }));
  };

  const handleOwnerSend = async () => {
    if (!ownerInput.trim()) return;
    const isSystemCommand = ownerInput.startsWith('/'); 
    
    if (isSystemCommand) {
      const command = ownerInput.slice(1).toUpperCase();
      const quickRes = state.quickResponses.find(qr => qr.trigger === command);

      if (quickRes) {
        // If it's a quick response, send as a regular message
        const manualMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'assistant',
          content: quickRes.response,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setState(prev => ({
          ...prev,
          sessions: prev.sessions.map(s => s.id === activeSessionId ? {
            ...s,
            messages: [...s.messages, manualMsg],
            lastMessage: quickRes.response,
            lastMessageTime: manualMsg.timestamp
          } : s)
        }));
      } else {
        // Otherwise try structural commands
        const result = await getOwnerResponse(state, ownerInput.slice(1));
        if (result.action) {
          const { type, payload } = result.action;
          if (type === 'BLOCK_DATE') {
            setState(prev => ({ ...prev, blockedDates: [...prev.blockedDates, payload] }));
          } else if (type === 'SET_AVAILABILITY') {
            setState(prev => ({
              ...prev,
              products: prev.products.map(p => p.name.toLowerCase() === payload.name.toLowerCase() ? { ...p, available: payload.available } : p)
            }));
          }
        }
        const adminMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `🔧 [SISTEMA]: ${result.reply}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setState(prev => ({ ...prev, sessions: prev.sessions.map(s => s.id === activeSessionId ? { ...s, messages: [...s.messages, adminMsg] } : s) }));
      }
    } else {
      const manualMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: ownerInput,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setState(prev => ({
        ...prev,
        sessions: prev.sessions.map(s => s.id === activeSessionId ? {
          ...s,
          messages: [...s.messages, manualMsg],
          lastMessage: ownerInput,
          lastMessageTime: manualMsg.timestamp
        } : s)
      }));
    }
    setOwnerInput('');
  };

  const simulateCustomerMessage = (text: string) => {
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setState(prev => ({
      ...prev,
      sessions: prev.sessions.map(s => s.id === activeSessionId ? {
        ...s,
        messages: [...s.messages, userMsg],
        lastMessage: text,
        lastMessageTime: userMsg.timestamp,
        unreadCount: 0
      } : s)
    }));
    triggerAIReply(activeSessionId, text);
  };

  const updateOrderStatus = (orderId: string, newStatus: Order['status']) => {
    setState(prev => ({
      ...prev,
      orders: prev.orders.map(o => o.id === orderId ? { ...o, status: newStatus } : o)
    }));
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    updateOrderStatus(draggableId, destination.droppableId as Order['status']);
  };

  return (
    <div className="flex h-screen bg-[#f0f2f5] overflow-hidden font-sans">
      
      {/* GLOBAL SYSTEM SIDEBAR (Left) */}
      <aside className="w-16 md:w-20 bg-[#121b21] flex flex-col items-center py-6 gap-8 z-30 flex-shrink-0">
        <div className="w-10 h-10 bg-[#00a884] rounded-xl flex items-center justify-center text-white shadow-lg mb-4">
          <Coffee className="w-6 h-6" />
        </div>
        
        <nav className="flex flex-col gap-6 w-full items-center">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { id: 'chat', icon: MessageCircle, label: 'Atendimento' },
            { id: 'kanban', icon: Kanban, label: 'Produção' },
            { id: 'drivers', icon: Bike, label: 'Motoboys' },
            { id: 'calendar', icon: CalendarIcon, label: 'Agenda' },
            { id: 'ai-configs', icon: Bot, label: 'Cérebro IA' },
          ].map(item => (
            <button 
              key={item.id}
              onClick={() => setActiveView(item.id as View)}
              title={item.label}
              className={`p-3 rounded-xl transition-all relative group ${activeView === item.id ? 'bg-[#00a884] text-white shadow-md' : 'text-gray-500 hover:text-white'}`}
            >
              <item.icon className="w-5 h-5 md:w-6 md:h-6" />
              {state.sessions.some(s => s.unreadCount > 0) && item.id === 'chat' && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-[#121b21]" />
              )}
              <span className="absolute left-full ml-4 px-2 py-1 bg-gray-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                {item.label}
              </span>
            </button>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-4">
           <button 
             onClick={() => setActiveView('settings')}
             className={`p-3 transition-colors rounded-xl ${activeView === 'settings' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white'}`}
           >
              <Settings className="w-6 h-6" />
           </button>
           <button 
             onClick={() => setActiveView('profile')}
             className={`w-10 h-10 rounded-full border-2 transition-all p-0.5 overflow-hidden shadow-inner ${activeView === 'profile' ? 'border-[#00a884] scale-110' : 'border-[#121b21] hover:border-gray-500'}`}
           >
              <img src={state.profile.avatar} alt="Avatar" className="w-full h-full rounded-full object-cover" />
           </button>
        </div>
      </aside>

      {/* Main Content Area (Conditional View) */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        
        {activeView === 'chat' ? (
          /* Multi-atendimento Dashboard View (Already Implemented) */
          <div className="flex flex-1 overflow-hidden">
             {/* Sidebar: Chats List */}
            <aside className="w-80 md:w-96 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 animate-in slide-in-from-left duration-300">
              <div className="p-3 h-12 flex items-center bg-[#f0f2f5] border-b border-gray-200">
                <h2 className="text-sm font-bold text-gray-700">Conversas Ativas</h2>
              </div>
              <div className="p-3 bg-[#f0f2f5]">
                <div className="bg-white rounded-lg flex items-center px-3 py-1.5 shadow-sm border border-gray-100">
                  <Search className="w-4 h-4 text-gray-400" />
                  <input type="text" placeholder="Pesquisar..." className="bg-transparent border-none outline-none text-sm px-3 w-full" />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 custom-scrollbar">
                {state.sessions.map(session => (
                  <div key={session.id} onClick={() => setActiveSessionId(session.id)} className={`flex items-center gap-3 p-3 cursor-pointer transition-colors border-b border-gray-50 ${activeSessionId === session.id ? 'bg-[#f0f2f5]' : 'hover:bg-gray-50'}`}>
                    <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden border border-gray-100">
                      <User className="w-6 h-6 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-0.5">
                        <h3 className="text-sm font-semibold text-gray-800 truncate">{session.customerName}</h3>
                        <span className="text-[10px] text-gray-500">{session.lastMessageTime}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <p className="text-xs text-gray-500 truncate pr-2">{session.lastMessage}</p>
                        <div className="flex items-center gap-1">
                          {session.alerts && session.alerts.length > 0 && (
                            <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full" title={session.alerts.join(', ')}>
                              !!
                            </span>
                          )}
                          {session.unreadCount > 0 && <span className="bg-[#25d366] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{session.unreadCount}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </aside>

            {/* Chat Content */}
            <main className="flex-1 bg-[#e5ddd5] flex flex-col relative overflow-hidden" style={{ backgroundImage: 'url("https://wweb.dev/assets/whatsapp-chat-back.png")' }}>
              <div className="bg-[#f0f2f5] h-16 flex items-center justify-between px-4 border-b border-gray-200 flex-shrink-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center"><User className="text-gray-600 w-5 h-5" /></div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                       {activeSession.customerName}
                       {activeSession.alerts && activeSession.alerts.length > 0 && (
                          <span className="bg-red-100 text-red-600 text-[9px] px-1.5 py-0.5 rounded-full font-bold capitalize">
                            Gatilhos Ativados: {activeSession.alerts.join(', ')}
                          </span>
                       )}
                    </h2>
                    <p className="text-[10px] text-gray-500">atendimento automático ativo</p>
                  </div>
                </div>
                <div className="flex gap-4 text-gray-500"><Phone className="w-4 h-4 cursor-pointer" /><Video className="w-5 h-5 cursor-pointer" /><div className="w-[1px] h-6 bg-gray-300" /><MoreVertical className="w-5 h-5 cursor-pointer" /></div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-2 custom-scrollbar flex flex-col">
                <div className="self-center bg-[#d1e4fc] text-[#4a5568] text-[10px] font-medium py-1 px-3 rounded-lg mb-4 shadow-sm uppercase tracking-wide">Criptografia de ponta a ponta</div>
                <AnimatePresence initial={false}>
                  {activeSession.messages.map((msg) => (
                    <motion.div key={msg.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[70%] px-3 py-1.5 rounded-lg shadow-sm relative group ${msg.role === 'user' ? 'bg-white text-gray-800 rounded-tl-none' : msg.content.includes('[SISTEMA]') ? 'bg-blue-100 text-blue-800 rounded-tr-none border border-blue-200' : 'bg-[#dcf8c6] text-gray-800 rounded-tr-none'}`}>
                        <p className="text-sm leading-relaxed">{msg.content}</p>
                        <div className="flex justify-end items-center gap-1 mt-0.5"><span className="text-[9px] opacity-50">{msg.timestamp}</span>{msg.role === 'assistant' && !msg.content.includes('[SISTEMA]') && <Check className="w-2.5 h-2.5 text-blue-500" />}</div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {isTyping[activeSessionId] && <div className="flex justify-start"><div className="bg-white px-3 py-2 rounded-lg rounded-tl-none shadow-sm flex items-center gap-1"><div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" /><div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" /><div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" /></div></div>}
              </div>

              <div className="px-4 py-3 bg-black/5 flex flex-wrap items-center justify-center gap-2 text-[10px] border-t border-gray-200">
                <span className="font-bold text-gray-500 uppercase tracking-wider mr-2">Painel de Teste:</span>
                <button onClick={() => simulateCustomerMessage("Oi, ainda tem coxinha de frango?")} className="bg-white hover:bg-orange-50 hover:text-orange-600 px-3 py-1.5 rounded-full shadow-sm border border-gray-200 transition-colors font-medium">"Tem coxinha?"</button>
                <button onClick={() => simulateCustomerMessage("Quero encomendar 50 salgados pro dia 23.")} className="bg-white hover:bg-orange-50 hover:text-orange-600 px-3 py-1.5 rounded-full shadow-sm border border-gray-200 transition-colors font-medium">"Encomendar dia 23"</button>
                <button onClick={() => simulateCustomerMessage("Vocês têm Coca-Cola Zero Lata?")} className="bg-white hover:bg-orange-50 hover:text-orange-600 px-3 py-1.5 rounded-full shadow-sm border border-gray-200 transition-colors font-medium">"Tem Coca Zero?"</button>
                <button onClick={() => simulateCustomerMessage("Queria fazer um pedido para o dia 28/04.")} className="bg-white hover:bg-orange-50 hover:text-orange-600 px-3 py-1.5 rounded-full shadow-sm border border-gray-200 transition-colors font-medium">"Testar Data 28/04"</button>
                <button onClick={() => simulateCustomerMessage("Qual o horário normal de funcionamento?")} className="bg-white hover:bg-orange-50 hover:text-orange-600 px-3 py-1.5 rounded-full shadow-sm border border-gray-200 transition-colors font-medium">"Horário de vocês"</button>
              </div>

              <div className="bg-[#f0f2f5] p-3 flex flex-col gap-2 flex-shrink-0 relative">
                {/* Macro Suggestion Menu */}
                <AnimatePresence>
                  {ownerInput.startsWith('/') && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute bottom-full left-4 mb-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden z-50 overflow-y-auto max-h-48"
                    >
                      <div className="p-2 border-b border-gray-50 bg-gray-50/50 flex justify-between items-center">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Respostas Rápidas (Macros)</span>
                        <Bot className="w-3 h-3 text-blue-500" />
                      </div>
                      <div className="flex flex-col">
                        {state.quickResponses
                          .filter(qr => qr.trigger.includes(ownerInput.slice(1).toUpperCase()))
                          .map(qr => (
                            <button 
                              key={qr.id}
                              onClick={() => {
                                setOwnerInput(`/${qr.trigger}`);
                              }}
                              className="flex flex-col p-3 hover:bg-green-50 text-left transition-colors border-b border-gray-50 last:border-0"
                            >
                              <span className="text-xs font-bold text-gray-800">/{qr.trigger}</span>
                              <span className="text-[10px] text-gray-500 truncate">{qr.response}</span>
                            </button>
                          ))
                        }
                        {state.quickResponses.filter(qr => qr.trigger.includes(ownerInput.slice(1).toUpperCase())).length === 0 && (
                           <div className="p-4 text-center text-xs text-gray-400 italic">Comando não encontrado...</div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex items-center gap-3 w-full">
                  <Smile className="text-gray-500 w-6 h-6 cursor-pointer" />
                  <Paperclip className="text-gray-500 w-5 h-5 cursor-pointer -rotate-45" />
                  <div className="flex-1 relative flex items-center">
                    <input type="text" value={ownerInput} onChange={(e) => setOwnerInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleOwnerSend()} placeholder={ownerInput.startsWith('/') ? "Escolha um macro ou digite comando..." : "Digite uma mensagem ou /macro"} className="w-full bg-white border-none rounded-lg px-4 py-2.5 text-sm outline-none shadow-sm focus:ring-1 focus:ring-green-400" />
                    <div className="absolute right-3 flex items-center gap-2">{ownerInput.startsWith('/') ? <Bot className="w-4 h-4 text-blue-500" /> : <UserCheck className="w-4 h-4 text-[#00a884]" />}</div>
                  </div>
                  <button onClick={handleOwnerSend} className={`p-2.5 rounded-full transition-all ${ownerInput ? 'bg-[#00a884] text-white' : 'text-gray-500'}`}><Send className={`w-5 h-5 ${ownerInput ? 'fill-current' : ''}`} /></button>
                </div>
              </div>
            </main>
          </div>
        ) : (
          <div className="flex-1 bg-white flex flex-col min-h-0 h-full overflow-hidden animate-in fade-in duration-500">
            {activeView === 'dashboard' && <DashboardView state={state} setActiveView={setActiveView} />}
            {activeView === 'kanban' && <KanbanView state={state} onDragEnd={onDragEnd} setActiveView={setActiveView} />}
            {activeView === 'calendar' && (
              <CalendarView 
                state={state} 
                selectedDate={selectedDate} 
                setSelectedDate={setSelectedDate} 
                showDatePicker={showDatePicker} 
                setShowDatePicker={setShowDatePicker} 
              />
            )}
            {activeView === 'ai-configs' && (
              <AIConfigsView 
                state={state}
                setState={setState} 
              />
            )}
            {activeView === 'settings' && (
              <SettingsView 
                state={state}
                setState={setState} 
              />
            )}
            {activeView === 'profile' && (
              <ProfileView 
                state={state}
                setState={setState} 
              />
            )}
            {activeView === 'drivers' && (
              <DriversView 
                state={state}
                setState={setState} 
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
