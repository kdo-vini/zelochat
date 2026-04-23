import React from 'react';
import { Package, MessageCircle, Coffee, Bot } from 'lucide-react';
import { ZeloState } from '../../types';
import { STATUS_LABELS, STATUS_COLORS } from '../../constants';

type View = 'dashboard' | 'chat' | 'kanban' | 'calendar' | 'ai-configs' | 'settings' | 'profile' | 'drivers';

export const DashboardView = ({ state, setActiveView }: { state: ZeloState, setActiveView: (v: View) => void }) => (
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
