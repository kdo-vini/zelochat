import React, { useEffect, useRef, useState } from 'react';
import { Plus, Send, Bot, Bell, AlignLeft, Clock, Loader2, Trash2, Zap, UserCog, Sparkles, Save, Check, Shield } from 'lucide-react';
import { ZeloState, ChatMessage, Trigger, TriggerKind, QuickResponse } from '../../types';
import { getOwnerResponse, getGeneralManagerResponse, generateAgentInstructions } from '../../services/openaiService';
import { useBuiltinTriggers } from '../../hooks/useBuiltinTriggers';

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
  quickResponses: QuickResponse[];
  addQuickResponse: () => Promise<QuickResponse>;
  updateQuickResponse: (id: string, patch: Partial<Pick<QuickResponse, 'trigger' | 'response'>>) => Promise<void>;
  deleteQuickResponse: (id: string) => Promise<void>;
  saveAiInstructions: (instructions: string) => Promise<boolean>;
  token: string | null;
}

export const AIConfigsView = ({
  state,
  setState,
  triggers,
  triggersError,
  createTrigger,
  updateTrigger,
  deleteTrigger,
  quickResponses,
  addQuickResponse,
  updateQuickResponse,
  deleteQuickResponse,
  saveAiInstructions,
  token,
}: AIConfigsViewProps) => {
  const builtinTriggers = useBuiltinTriggers(token);
  const [managerInput, setManagerInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [managerChatInput, setManagerChatInput] = useState('');
  const [triggerInput, setTriggerInput] = useState('');
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [triggerLocalError, setTriggerLocalError] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState(state.aiInstructions || '');
  const [promptDirty, setPromptDirty] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptJustSaved, setPromptJustSaved] = useState(false);
  const [promptGenerating, setPromptGenerating] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const qrDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [qrSaveState, setQrSaveState] = useState<Record<string, 'saving' | 'saved'>>({});
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Sync draft when aiInstructions loads from DB
  useEffect(() => {
    if (!promptDirty) setPromptDraft(state.aiInstructions || '');
  }, [state.aiInstructions, promptDirty]);

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

  const handleGeneratePrompt = async () => {
    setPromptGenerating(true);
    setPromptError(null);
    try {
      const generated = await generateAgentInstructions(promptDraft.trim() || undefined);
      if (generated) {
        setPromptDraft(generated);
        setPromptDirty(true);
        setPromptJustSaved(false);
        promptRef.current?.focus();
      } else {
        setPromptError('A IA não retornou conteúdo. Tente novamente.');
      }
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Falha ao gerar instruções.');
    } finally {
      setPromptGenerating(false);
    }
  };

  const handleSavePrompt = async () => {
    setPromptSaving(true);
    setPromptError(null);
    try {
      const ok = await saveAiInstructions(promptDraft);
      if (ok) {
        setState(prev => ({ ...prev, aiInstructions: promptDraft }));
        setPromptDirty(false);
        setPromptJustSaved(true);
        setTimeout(() => setPromptJustSaved(false), 2000);
      } else {
        setPromptError('Não foi possível salvar. Verifique sua conexão.');
      }
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setPromptSaving(false);
    }
  };

  const scheduleQrSave = (id: string, patch: Partial<Pick<QuickResponse, 'trigger' | 'response'>>) => {
    if (qrDebounceRef.current[id]) clearTimeout(qrDebounceRef.current[id]);
    qrDebounceRef.current[id] = setTimeout(async () => {
      setQrSaveState(prev => ({ ...prev, [id]: 'saving' }));
      try {
        await updateQuickResponse(id, patch);
        setQrSaveState(prev => ({ ...prev, [id]: 'saved' }));
        setTimeout(() => setQrSaveState(prev => { const next = { ...prev }; delete next[id]; return next; }), 2000);
      } catch (err) {
        console.error('[AIConfigs] update QR failed:', err);
        setQrSaveState(prev => { const next = { ...prev }; delete next[id]; return next; });
      }
    }, 400);
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
              subtitle="Use /GATILHO no chat para enviar instantaneamente — salvas automaticamente"
              action={
                <button
                  onClick={() => { void addQuickResponse().catch((err) => console.error('[AIConfigs] add QR failed:', err)); }}
                  className="h-7 px-2.5 bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] rounded-md text-[12px] font-semibold flex items-center gap-1 hover:bg-[var(--color-line)] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>
              }
            />
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {quickResponses.length === 0 ? (
                <p className="text-[13px] text-center text-[var(--color-ink-faint)] mt-6">Nenhum macro configurado.</p>
              ) : (
                quickResponses.map(qr => (
                  <div key={qr.id} className="flex gap-2 items-center bg-[var(--color-surface-muted)] border border-[var(--color-line)] px-3 py-2 rounded-lg group">
                    <span className="text-[12px] font-mono font-bold text-[var(--color-ink-muted)]">/</span>
                    <input
                      type="text"
                      defaultValue={qr.trigger}
                      onChange={e => {
                        const next = e.target.value.toUpperCase();
                        e.target.value = next;
                        scheduleQrSave(qr.id, { trigger: next });
                      }}
                      className="w-24 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2 py-1 text-[12.5px] font-semibold font-mono uppercase outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20"
                      placeholder="GATILHO"
                    />
                    <input
                      type="text"
                      defaultValue={qr.response}
                      onChange={e => scheduleQrSave(qr.id, { response: e.target.value })}
                      className="flex-1 bg-transparent outline-none text-[13px] min-w-0"
                      placeholder="Texto da resposta..."
                    />
                    <span className="flex-shrink-0 w-4 flex items-center justify-center">
                      {qrSaveState[qr.id] === 'saving' && <Loader2 className="w-3.5 h-3.5 text-[var(--color-ink-faint)] animate-spin" />}
                      {qrSaveState[qr.id] === 'saved' && <Check className="w-3.5 h-3.5 text-[var(--color-brand)]" />}
                    </span>
                    <button
                      onClick={() => { void deleteQuickResponse(qr.id).catch((err) => console.error('[AIConfigs] delete QR failed:', err)); }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)] rounded-md transition-all flex-shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5 rotate-45" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden flex flex-col">
            <SectionHeader
              icon={Shield}
              title="Gatilhos automáticos do sistema"
              subtitle="Sempre ativos por padrão. Se desativar, a IA não vai mais escalar essas situações automaticamente."
            />
            <div className="p-3 space-y-2">
              {builtinTriggers.loading && builtinTriggers.items.length === 0 ? (
                <p className="text-[12.5px] text-center text-[var(--color-ink-faint)] py-2">Carregando…</p>
              ) : (
                builtinTriggers.items.map((b) => (
                  <div
                    key={b.id}
                    className="bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-2.5 space-y-1"
                  >
                    <div className="flex items-start gap-2">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold uppercase tracking-wide flex-shrink-0 bg-[var(--color-warn-soft)] text-[var(--color-warn)]">
                        <Shield className="w-2.5 h-2.5" />
                        Sistema
                      </span>
                      <span className="flex-1 text-[12.5px] font-semibold text-[var(--color-ink)] truncate">
                        {b.name}
                      </span>
                      <button
                        onClick={() => void builtinTriggers.setDisabled(b.id, !b.disabled).catch(() => {})}
                        className={`w-8 h-[18px] rounded-full relative flex-shrink-0 transition-colors ${
                          !b.disabled ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-line-strong)]'
                        }`}
                        title={b.disabled ? 'Ativar' : 'Desativar'}
                      >
                        <span
                          className={`absolute top-[2px] w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all ${
                            !b.disabled ? 'right-[2px]' : 'left-[2px]'
                          }`}
                        />
                      </button>
                    </div>
                    <p className="text-[11.5px] text-[var(--color-ink-muted)]">
                      {b.conditionDescription}
                    </p>
                  </div>
                ))
              )}
              {builtinTriggers.error && (
                <p className="text-[11px] text-[var(--color-alert)]">{builtinTriggers.error}</p>
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
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-line)]">
            <div className="flex items-center gap-2 min-w-0">
              <AlignLeft className="w-4 h-4 text-[var(--color-ink-muted)] flex-shrink-0" strokeWidth={1.8} />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold">Instruções base do agente</p>
                <p className="text-[11.5px] text-[var(--color-ink-muted)]">
                  O prompt mestre que define a personalidade e as regras absolutas da IA.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleGeneratePrompt}
                disabled={promptGenerating || promptSaving}
                title="Gerar com IA (usa o que estiver no campo como direcionamento opcional)"
                className="h-8 px-3 rounded-md text-[12px] font-semibold flex items-center gap-1.5 bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-brand-deep)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity shadow-sm"
              >
                {promptGenerating
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Sparkles className="w-3.5 h-3.5" />}
                {promptGenerating ? 'Gerando...' : 'Gerar com IA'}
              </button>
              <button
                onClick={handleSavePrompt}
                disabled={promptSaving || promptGenerating || (!promptDirty && !promptJustSaved)}
                className={`h-8 px-3 rounded-md text-[12px] font-semibold flex items-center gap-1.5 transition-colors ${
                  promptJustSaved
                    ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                    : promptDirty
                      ? 'bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink-soft)]'
                      : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-faint)]'
                } disabled:cursor-not-allowed`}
              >
                {promptSaving
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : promptJustSaved
                    ? <Check className="w-3.5 h-3.5" />
                    : <Save className="w-3.5 h-3.5" />}
                {promptSaving ? 'Salvando...' : promptJustSaved ? 'Salvo' : 'Salvar'}
              </button>
            </div>
          </div>
          <div className="p-4 space-y-2">
            <textarea
              ref={promptRef}
              className="w-full h-40 bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-4 text-[13px] font-mono outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] resize-none leading-relaxed transition-colors"
              value={promptDraft}
              onChange={e => { setPromptDraft(e.target.value); setPromptDirty(true); setPromptJustSaved(false); }}
              placeholder="Descreva como sua IA deve falar, o tom, limites e prioridades — ou clique em Gerar com IA."
            />
            {promptError && (
              <p className="text-[12px] text-[var(--color-alert)]">{promptError}</p>
            )}
            <p className="text-[11.5px] text-[var(--color-ink-faint)]">
              Salvo no banco por empresa — a IA do WhatsApp usa este texto automaticamente ao responder clientes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
