import React, { useState } from 'react';
import { Clock, Moon, Plus, Send, Bot, Bell, Settings } from 'lucide-react';
import { ZeloState, ChatMessage } from '../../types';
import { getOwnerResponse } from '../../services/openaiService';

// Fallback in case it wasn't exported from geminiService properly in App.tsx
// It was used in App.tsx but might be missing from imports if it was a mock
const getGeneralManagerResponse = async (history: any[], msg: string): Promise<{ reply: string, actions: any[] }> => {
  return { reply: "Função não implementada no serviço base.", actions: [] };
};

export const AIConfigsView = ({ state, setState }: { state: ZeloState, setState: React.Dispatch<React.SetStateAction<ZeloState>> }) => {
  const [managerInput, setManagerInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcessContext = async () => {
    if (!managerInput.trim()) return;
    setIsProcessing(true);
    try {
      const newRules = await getOwnerResponse(managerInput);
      const newContexts = newRules.map((text: string) => ({ id: Date.now().toString() + Math.random(), text }));
      setState(prev => ({
        ...prev,
        dailyContext: [...(prev.dailyContext || []), ...newContexts]
      }));
      setManagerInput('');
    } catch (e) {
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
                <p className="text-xs italic text-center">Nenhuma regra ativa para hoje.<br />A lanchonete opera normalmente.</p>
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
                <p className="text-xs italic text-center">Fale com a IA. Ex:<br />"Não vamos abrir final de semana."</p>
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
