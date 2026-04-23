import React, { useState, useRef } from 'react';
import { Plus, Send, Bot, Bell, AlignLeft, Clock, Loader2, Trash2, Zap, UserCog } from 'lucide-react';
import { ZeloState, ChatMessage, Trigger, TriggerKind } from '../../types';
import { getOwnerResponse, getGeneralManagerResponse } from '../../services/openaiService';

const FIELD = 'w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-3 py-2 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] transition-colors';

const SectionHeader = ({ icon: Icon, title, subtitle, action }: {
  icon: typeof Clock;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-line)] bg-[var(--color-surface-muted)]/50">
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
      <div>
        <p className="text-[13.5px] font-semibold">{title}</p>
        {subtitle && <p className="text-[11.5px] text-[var(--color-ink-muted)] mt-[-1px]">{subtitle}</p>}
      </div>
    </div>
    {action}
  </div>
);

interface AIConfigsViewProps {
  state: ZeloState;
  setState: React.Dispatch<React.SetStateAction<ZeloState>>;
  triggers: Trigger[];
  triggersError: string | null;
  createTrigger: (naturalInput: string) => Promise<Trigger>;
  updateTrigger: (id: string, patch: { name?: string; conditionDescription?: string; active?: boolean; kind?: TriggerKind }) => Promise<Trigger>;
  deleteTrigger: (id: string) => Promise<void>;
}

export const AIConfigsView = ({
  state,
  setState,
  triggers,
  triggersError,
  createTrigger,
  updateTrigger,
  deleteTrigger,
}: AIConfigsViewProps) => {
  const [managerInput, setManagerInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [managerChatInput, setManagerChatInput] = useState('');
  const [triggerInput, setTriggerInput] = useState('');
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [triggerLocalError, setTriggerLocalError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const handleCreateTrigger = async () => {
    if (!triggerInput.trim()) return;
    setTriggerBusy(true);
    setTriggerLocalError(null);
    try {
      await createTrigger(triggerInput.trim());
      setTriggerInput('');
    } catch (err) {
      setTriggerLocalError(err instanceof Error ? err.message : 'Erro ao criar gatilho.');
    } finally {
      setTriggerBusy(false);
    }
  };

  const handleProcessContext = async () => {
    if (!managerInput.trim()) return;
    setIsProcessing(true);
    try {
      const newRules = await getOwnerResponse(managerInput);
      const newContexts = newRules.map((text: string) => ({ id: Date.now().toString() + Math.random(), text }));
      setState(prev => ({ ...prev, dailyContext: [...(prev.dailyContext || []), ...newContexts] }));
      setManagerInput('');
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); }
  };

  const handleGeneralManagerSend = async () => {
    if (!managerChatInput.trim()) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: managerChatInput, preview: managerChatInput, kind: 'text', timestamp: new Date().toISOString() };
    setState(prev => ({ ...prev, managerHistory: [...(prev.managerHistory || []), userMsg] }));
    setManagerChatInput('');
    setIsProcessing(true);
    try {
      const currentHistory = [...(state.managerHistory || []), userMsg];
      const result = await getGeneralManagerResponse(currentHistory, userMsg.content);
      const botMsg: ChatMessage = { id: Date.now().toString(), role: 'assistant', content: result.reply, preview: result.reply, kind: 'text', timestamp: new Date().toISOString() };
      setState(prev => {
        let newState = { ...prev, managerHistory: [...(prev.managerHistory || []), botMsg] };
        if (result.actions?.length > 0) {
          result.actions.forEach((action: { type: string; payload: { date: string; reason: string } }) => {
            if (action.type === 'BLOCK_DATE') {
              newState.blockedDates = [...newState.blockedDates, action.payload];
            }
          });
        }
        return newState;
      });
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1100px] mx-auto px-8 py-8 space-y-6">
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight">Cérebro IA</h1>
          <p className="text-[13px] text-[var(--color-ink-muted)]">Configure como a IA responde no WhatsApp e defina regras do negócio.</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Daily Context */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden flex flex-col h-[300px]">
            <SectionHeader
              icon={Clock}
              title="Avisos de hoje"
              subtitle="O que mudou hoje na lanchonete?"
              action={
                state.dailyContext?.length > 0 ? (
                  <button
                    onClick={() => setState(prev => ({ ...prev, dailyContext: [] }))}
                    className="text-[11.5px] font-semibold text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)] px-2 py-1 rounded-md transition-colors"
                  >
                    Limpar
                  </button>
                ) : undefined
              }
            />
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {(!state.dailyContext || state.dailyContext.length === 0) ? (
                <div className="h-full flex flex-col items-center justify-center text-[var(--color-ink-faint)]">
                  <p className="text-[13px]">Nenhum aviso ativo.</p>
                  <p className="text-[12px] mt-1">A lanchonete opera normalmente.</p>
                </div>
              ) : (
                state.dailyContext.map(ctx => (
                  <div key={ctx.id} className="flex gap-2 items-center bg-[var(--color-surface-muted)] border border-[var(--color-line)] px-3 py-2 rounded-lg group">
                    <span className="w-1.5 h-1.5 bg-[var(--color-brand)] rounded-full flex-shrink-0" />
                    <input
                      type="text"
                      value={ctx.text}
                      onChange={e => setState(prev => ({
                        ...prev,
                        dailyContext: prev.dailyContext.map(c => c.id === ctx.id ? { ...c, text: e.target.value } : c),
                      }))}
                      className="flex-1 bg-transparent outline-none text-[13px]"
                    />
                    <button
                      onClick={() => setState(prev => ({ ...prev, dailyContext: prev.dailyContext.filter(c => c.id !== ctx.id) }))}
                      className="opacity-0 group-hover:opacity-100 p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)] rounded-md transition-all"
                      aria-label="Remover aviso"
                    >
                      <Plus className="w-3.5 h-3.5 rotate-45" />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="p-3 border-t border-[var(--color-line)] bg-[var(--color-surface)]">
              <div className="flex gap-2">
                <input
                  value={managerInput}
                  onChange={e => setManagerInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleProcessContext()}
                  placeholder='Ex: "Acabou a coxinha de frango"'
                  className={`${FIELD} flex-1`}
                />
                <button
                  onClick={handleProcessContext}
                  disabled={isProcessing || !managerInput.trim()}
                  className="h-10 w-10 rounded-lg bg-[var(--color-ink)] text-white flex items-center justify-center disabled:opacity-40 hover:bg-[var(--color-ink-soft)] transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* General Manager Chat */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden flex flex-col h-[300px]">
            <SectionHeader
              icon={Bot}
              title="Gestão por conversa"
              subtitle="Bloqueie dias ou ajuste horários conversando com a IA"
            />
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {state.managerHistory.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-[13px] text-[var(--color-ink-faint)] text-center">
                    Ex: "Não vamos abrir no sábado"
                  </p>
                </div>
              ) : (
                state.managerHistory.map(msg => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`text-[13px] px-3 py-2 rounded-lg max-w-[85%] ${
                      msg.role === 'user'
                        ? 'bg-[var(--color-ink)] text-white rounded-br-[4px]'
                        : 'bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-bl-[4px]'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
              {isProcessing && (
                <div className="text-[12.5px] text-[var(--color-ink-faint)] italic">IA digitando...</div>
              )}
            </div>
            <div className="p-3 border-t border-[var(--color-line)] bg-[var(--color-surface)]">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={managerChatInput}
                  onChange={e => setManagerChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGeneralManagerSend()}
                  placeholder="Pedir para a IA..."
                  className={`${FIELD} flex-1`}
                />
                <button
                  onClick={handleGeneralManagerSend}
                  disabled={isProcessing || !managerChatInput.trim()}
                  className="h-10 w-10 rounded-lg bg-[var(--color-ink)] text-white flex items-center justify-center disabled:opacity-40 hover:bg-[var(--color-ink-soft)] transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Macros + Triggers */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden flex flex-col h-[280px]">
            <SectionHeader
              icon={Send}
              title="Respostas rápidas (macros)"
              subtitle="Use /GATILHO no chat para enviar instantaneamente"
              action={
                <button
                  onClick={() => setState(prev => ({
                    ...prev,
                    quickResponses: [{ id: Date.now().toString(), trigger: '', response: '' }, ...prev.quickResponses],
                  }))}
                  className="h-7 px-2.5 bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] rounded-md text-[12px] font-semibold flex items-center gap-1 hover:bg-[var(--color-line)] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>
              }
            />
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {state.quickResponses.length === 0 ? (
                <p className="text-[13px] text-center text-[var(--color-ink-faint)] mt-6">Nenhum macro configurado.</p>
              ) : (
                state.quickResponses.map(qr => (
                  <div key={qr.id} className="flex gap-2 items-center bg-[var(--color-surface-muted)] border border-[var(--color-line)] px-3 py-2 rounded-lg group">
                    <span className="text-[12px] font-mono font-bold text-[var(--color-ink-muted)]">/</span>
                    <input
                      type="text"
                      value={qr.trigger}
                      onChange={e => setState(prev => ({
                        ...prev,
                        quickResponses: prev.quickResponses.map(q => q.id === qr.id ? { ...q, trigger: e.target.value.toUpperCase() } : q),
                      }))}
                      className="w-24 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2 py-1 text-[12.5px] font-semibold font-mono uppercase outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20"
                      placeholder="GATILHO"
                    />
                    <input
                      type="text"
                      value={qr.response}
                      onChange={e => setState(prev => ({
                        ...prev,
                        quickResponses: prev.quickResponses.map(q => q.id === qr.id ? { ...q, response: e.target.value } : q),
                      }))}
                      className="flex-1 bg-transparent outline-none text-[13px] min-w-0"
                      placeholder="Texto da resposta..."
                    />
                    <button
                      onClick={() => setState(prev => ({ ...prev, quickResponses: prev.quickResponses.filter(q => q.id !== qr.id) }))}
                      className="opacity-0 group-hover:opacity-100 p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)] rounded-md transition-all flex-shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5 rotate-45" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden flex flex-col h-[280px]">
            <SectionHeader
              icon={Bell}
              title="Triggers personalizados"
              subtitle="Descreva o comportamento em português"
            />
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {triggers.length === 0 ? (
                <p className="text-[12.5px] text-center text-[var(--color-ink-faint)] mt-6 px-4">
                  Nenhum trigger ainda. Descreva um cenário abaixo — a IA extrai o que precisa.
                </p>
              ) : (
                triggers.map(t => (
                  <div key={t.id} className="group bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-2.5 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold uppercase tracking-wide flex-shrink-0 ${
                        t.kind === 'escalate_human'
                          ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
                          : 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                      }`}>
                        {t.kind === 'escalate_human' ? <UserCog className="w-2.5 h-2.5" /> : <Zap className="w-2.5 h-2.5" />}
                        {t.kind === 'escalate_human' ? 'Escalar' : 'Notificar'}
                      </span>
                      <input
                        value={t.name}
                        onChange={e => {
                          const next = e.target.value;
                          void updateTrigger(t.id, { name: next }).catch(() => {});
                        }}
                        className="flex-1 bg-transparent outline-none text-[12.5px] font-semibold min-w-0"
                      />
                      <button
                        onClick={() => void updateTrigger(t.id, { active: !t.active }).catch(() => {})}
                        className={`w-8 h-[18px] rounded-full relative flex-shrink-0 transition-colors ${
                          t.active ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-line-strong)]'
                        }`}
                        title={t.active ? 'Desativar' : 'Ativar'}
                      >
                        <span className={`absolute top-[2px] w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all ${
                          t.active ? 'right-[2px]' : 'left-[2px]'
                        }`} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Remover o trigger "${t.name}"?`)) {
                            void deleteTrigger(t.id).catch(() => {});
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-alert)] rounded transition-all"
                        title="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                    </div>
                    <input
                      value={t.conditionDescription}
                      onChange={e => {
                        const next = e.target.value;
                        void updateTrigger(t.id, { conditionDescription: next }).catch(() => {});
                      }}
                      className="w-full bg-transparent outline-none text-[11.5px] text-[var(--color-ink-muted)]"
                    />
                  </div>
                ))
              )}
            </div>
            <div className="p-3 border-t border-[var(--color-line)] bg-[var(--color-surface)] space-y-1.5">
              {(triggerLocalError || triggersError) && (
                <p className="text-[11px] text-[var(--color-alert)]">{triggerLocalError ?? triggersError}</p>
              )}
              <div className="flex gap-2">
                <input
                  value={triggerInput}
                  onChange={e => setTriggerInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateTrigger()}
                  placeholder='Ex: "avise o gerente se pedirem mais de R$200"'
                  className={`${FIELD} flex-1`}
                />
                <button
                  onClick={handleCreateTrigger}
                  disabled={triggerBusy || !triggerInput.trim()}
                  className="h-10 w-10 rounded-lg bg-[var(--color-ink)] text-white flex items-center justify-center disabled:opacity-40 hover:bg-[var(--color-ink-soft)] transition-colors"
                >
                  {triggerBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* System Prompt */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-line)]">
            <div className="flex items-center gap-2">
              <AlignLeft className="w-4 h-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
              <div>
                <p className="text-[13.5px] font-semibold">Instruções base do agente</p>
                <p className="text-[11.5px] text-[var(--color-ink-muted)]">
                  O prompt mestre que define a personalidade e as regras absolutas da IA.
                </p>
              </div>
            </div>
            <button
              onClick={() => promptRef.current?.focus()}
              className="h-7 px-2.5 bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] rounded-md text-[12px] font-semibold hover:bg-[var(--color-line)] transition-colors"
            >
              Editar
            </button>
          </div>
          <div className="p-4">
            <textarea
              ref={promptRef}
              className="w-full h-32 bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-4 text-[13px] font-mono outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] resize-none leading-relaxed transition-colors"
              defaultValue={state.aiInstructions}
              onChange={e => setState(prev => ({ ...prev, aiInstructions: e.target.value }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
