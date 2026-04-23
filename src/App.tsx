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
  ChevronLeft, ChevronRight, Bell, Moon, Sun, Camera, LogOut, Bike, MapPin,
  Smartphone, RefreshCw, Wifi, WifiOff, QrCode, Loader2
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ZeloState, ChatMessage, ChatSession, Order, Product, DeliveryDriver } from './types';
import { INITIAL_STATE, STATUS_LABELS, STATUS_COLORS } from './constants';
import { getClientResponse, getOwnerResponse } from './services/openaiService';

type View = 'dashboard' | 'chat' | 'kanban' | 'calendar' | 'ai-configs' | 'settings' | 'profile' | 'drivers';

import { DashboardView } from './components/views/DashboardView';
import { KanbanView } from './components/views/KanbanView';
import { CalendarView } from './components/views/CalendarView';
import { AIConfigsView } from './components/views/AIConfigsView';
import { SettingsView } from './components/views/SettingsView';
import { ProfileView } from './components/views/ProfileView';
import { DriversView } from './components/views/DriversView';
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
        const result = await getOwnerResponse(ownerInput.slice(1));
        const adminMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `🔧 [SISTEMA]: Contexto atualizado:\n${result.join('\n')}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        const newContexts = result.map((text: string) => ({ id: Date.now().toString() + Math.random(), text }));
        setState(prev => ({
          ...prev,
          dailyContext: [...(prev.dailyContext || []), ...newContexts],
          sessions: prev.sessions.map(s => s.id === activeSessionId ? { ...s, messages: [...s.messages, adminMsg] } : s)
        }));
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
