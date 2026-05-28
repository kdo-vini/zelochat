import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocalDraft } from "../../hooks/useLocalDraft";
import {
  Plus,
  Send,
  Bot,
  Bell,
  AlignLeft,
  Clock,
  Loader2,
  Trash2,
  Zap,
  UserCog,
  Sparkles,
  Save,
  Check,
  Shield,
  ChevronDown,
  Activity,
  RefreshCw,
  ReceiptText,
  Tag as TagIcon,
  X as XIcon,
  Smartphone,
} from "lucide-react";
import {
  ZeloState,
  ChatMessage,
  Trigger,
  TriggerKind,
  QuickResponse,
  PixReceiptConfig,
  Tag,
} from "../../types";
import { useTags } from "../../hooks/useTags";
import { normalizePixReceiptConfig } from "../../domain/pixReceipt";
import { maskBrazilianPhone, normalizePhoneNumber } from "../../domain/chat";
import {
  getOwnerResponse,
  generateAgentInstructions,
  simulateAtendimento,
  type SimulateAtendimentoResult,
} from "../../services/openaiService";
import {
  getAiHealth,
  sendManagerAssistantMessage,
  type AiHealthReport,
  type AiHealthSummaryStatus,
} from "../../services/waApi";
import { useBuiltinTriggers } from "../../hooks/useBuiltinTriggers";
import { useToast } from "../../contexts/ToastContext";
import { ConfirmModal } from "../ConfirmModal";

const FIELD =
  "w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-3 py-2 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] transition-colors";
type AIConfigsState = Pick<
  ZeloState,
  | "aiInstructions"
  | "blockedDates"
  | "dailyContext"
  | "managerHistory"
  | "pixReceiptConfig"
>;

const REDIRECT_DEFAULT_MESSAGE =
  "Para este tipo de pedido, entre em contato pelo nosso outro número: {link} 😊";

const TRIGGER_KIND_OPTIONS: Array<{
  kind: TriggerKind;
  label: string;
  description: string;
  Icon: typeof Clock;
}> = [
  {
    kind: "notify_manager",
    label: "Notificar",
    description: "A IA avisa o gerente e continua atendendo.",
    Icon: Zap,
  },
  {
    kind: "escalate_human",
    label: "Escalar",
    description: "A IA chama um atendente e para a conversa automática.",
    Icon: UserCog,
  },
  {
    kind: "redirect_contact",
    label: "Encaminhar",
    description: "A IA envia o link do outro WhatsApp e encerra o turno.",
    Icon: Smartphone,
  },
];

function triggerKindMeta(kind: TriggerKind) {
  return (
    TRIGGER_KIND_OPTIONS.find((option) => option.kind === kind) ??
    TRIGGER_KIND_OPTIONS[0]
  );
}

function triggerKindTone(kind: TriggerKind): string {
  if (kind === "escalate_human")
    return "bg-[var(--color-warn-soft)] text-[var(--color-warn)]";
  return "bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]";
}

function formatRedirectPhonePreview(value?: string | null): string {
  const digits = normalizePhoneNumber(value ?? "");
  const local =
    digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  const formatted = maskBrazilianPhone(local);
  if (!formatted) return "Número não informado";
  return formatted.length > 12 ? `${formatted.slice(0, 12)}...` : formatted;
}

const SectionHeader = ({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: typeof Clock;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-line)] bg-[var(--color-surface-muted)]/50">
    <div className="flex items-center gap-2">
      <Icon
        className="w-4 h-4 text-[var(--color-ink-muted)]"
        strokeWidth={1.8}
      />
      <div>
        <p className="text-[13.5px] font-semibold">{title}</p>
        {subtitle && (
          <p className="text-[11.5px] text-[var(--color-ink-muted)] mt-[-1px]">
            {subtitle}
          </p>
        )}
      </div>
    </div>
    {action}
  </div>
);

type HealthTone = "ok" | "warn" | "neutral";

const HEALTH_TONE_CLASS: Record<HealthTone, string> = {
  ok: "bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]",
  warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
  neutral: "bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
};

function formatAiHealthStatus(status: AiHealthSummaryStatus | undefined): {
  label: string;
  tone: HealthTone;
} {
  if (status === "ready") return { label: "Pronta", tone: "ok" };
  if (status === "disabled") return { label: "IA desligada", tone: "warn" };
  if (status === "scheduled_off")
    return { label: "Agendada - fora da janela", tone: "neutral" };
  if (status === "needs_configuration")
    return { label: "Ajustar configuração", tone: "warn" };
  return { label: "Verificando...", tone: "neutral" };
}

function formatAiModeLabel(mode: AiHealthReport["aiMode"] | undefined): string {
  if (mode === "always_on") return "Sempre ligada";
  if (mode === "always_off") return "Sempre desligada";
  if (mode === "scheduled") return "Agendada";
  return "Verificando...";
}

interface ReadinessItemProps {
  label: string;
  value: string;
  tone: HealthTone;
}

const ReadinessItem: React.FC<ReadinessItemProps> = ({
  label,
  value,
  tone,
}) => (
  <div className="flex items-center justify-between gap-3 py-2 min-w-0">
    <span className="text-[12px] text-[var(--color-ink-muted)] truncate">
      {label}
    </span>
    <span
      className={`text-[11.5px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap ${HEALTH_TONE_CLASS[tone]}`}
    >
      {value}
    </span>
  </div>
);

interface AIConfigsViewProps {
  state: AIConfigsState;
  setState: React.Dispatch<React.SetStateAction<ZeloState>>;
  triggers: Trigger[];
  triggersError: string | null;
  createTrigger: (
    naturalInput: string,
    kind: TriggerKind,
    redirectPhone?: string | null,
    redirectMessage?: string | null,
  ) => Promise<Trigger>;
  updateTrigger: (
    id: string,
    patch: {
      name?: string;
      conditionDescription?: string;
      active?: boolean;
      kind?: TriggerKind;
      redirectPhone?: string | null;
      redirectMessage?: string | null;
    },
  ) => Promise<Trigger>;
  deleteTrigger: (id: string) => Promise<void>;
  quickResponses: QuickResponse[];
  addQuickResponse: () => Promise<QuickResponse>;
  updateQuickResponse: (
    id: string,
    patch: Partial<Pick<QuickResponse, "trigger" | "response">>,
  ) => Promise<void>;
  deleteQuickResponse: (id: string) => Promise<void>;
  saveAiInstructions: (instructions: string) => Promise<boolean>;
  savePixReceiptConfig: (config: PixReceiptConfig) => Promise<boolean>;
  token: string | null;
  refreshEmpresa?: () => Promise<void>;
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
  savePixReceiptConfig,
  token,
  refreshEmpresa,
}: AIConfigsViewProps) => {
  const builtinTriggers = useBuiltinTriggers(token);
  const {
    tags,
    createTag,
    updateTag: updateTagFn,
    deleteTag: deleteTagFn,
  } = useTags(token);
  const toast = useToast();
  const [tagForm, setTagForm] = useState<{
    name: string;
    color: string;
    aiInstructions: string;
    autoApplyCondition: string;
  } | null>(null);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null);
  const TAG_COLORS = [
    "#6366f1",
    "#ec4899",
    "#f97316",
    "#22c55e",
    "#0ea5e9",
    "#eab308",
    "#8b5cf6",
    "#64748b",
  ];

  // Modelos prontos de tag automática. Clicar abre o formulário já preenchido —
  // nada é aplicado até o dono clicar em "Criar".
  const AUTO_TAG_TEMPLATES: {
    name: string;
    color: string;
    autoApplyCondition: string;
    aiInstructions: string;
  }[] = [
    {
      name: "Delivery",
      color: "#0ea5e9",
      autoApplyCondition:
        'O cliente pede entrega, fala em "delivery", "entregar", ou diz que é de outra cidade / de fora.',
      aiInstructions: "",
    },
    {
      name: "Retirada",
      color: "#22c55e",
      autoApplyCondition:
        "O cliente vai retirar no balcão / buscar no local, ou diz que é aqui da cidade.",
      aiInstructions: "",
    },
  ];
  const [aiHealth, setAiHealth] = useState<AiHealthReport | null>(null);
  const [aiHealthLoading, setAiHealthLoading] = useState(false);
  const [aiHealthError, setAiHealthError] = useState<string | null>(null);
  const [deletingTrigger, setDeletingTrigger] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [managerInput, setManagerInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [managerChatInput, setManagerChatInput] = useState("");
  const [simulateInput, setSimulateInput] = useState(
    "vc pode mandar o cardapio?",
  );
  const [simulateResult, setSimulateResult] =
    useState<SimulateAtendimentoResult | null>(null);
  const [simulateLoading, setSimulateLoading] = useState(false);
  const [simulateError, setSimulateError] = useState<string | null>(null);
  const [triggerInput, setTriggerInput] = useState("");
  const [triggerKind, setTriggerKind] = useState<TriggerKind>("notify_manager");
  const [redirectPhone, setRedirectPhone] = useState("");
  const [redirectMessage, setRedirectMessage] = useState("");
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const kindMenuRef = useRef<HTMLDivElement>(null);
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [triggerLocalError, setTriggerLocalError] = useState<string | null>(
    null,
  );
  const {
    draft: promptDraft,
    setDraft: setPromptDraft,
    clearDraft: clearPromptDraft,
    isDirtyVsServer: promptDirty,
    hasStoredDraft: hasPromptDraft,
  } = useLocalDraft("ai_instructions", state.aiInstructions ?? "");
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptJustSaved, setPromptJustSaved] = useState(false);
  const [promptGenerating, setPromptGenerating] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [pixReceiptDraft, setPixReceiptDraft] = useState<PixReceiptConfig>(() =>
    normalizePixReceiptConfig(state.pixReceiptConfig),
  );
  const [pixReceiptSaving, setPixReceiptSaving] = useState(false);
  const qrDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const [qrSaveState, setQrSaveState] = useState<
    Record<string, "saving" | "saved">
  >({});
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const loadAiHealth = useCallback(async () => {
    if (!token) {
      setAiHealth(null);
      setAiHealthError(null);
      return;
    }

    setAiHealthLoading(true);
    setAiHealthError(null);
    try {
      setAiHealth(await getAiHealth(token));
    } catch (err) {
      console.error("[AIConfigs] AI health load failed:", err);
      setAiHealthError("Não foi possível carregar a saúde da IA agora.");
    } finally {
      setAiHealthLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAiHealth();
  }, [loadAiHealth]);

  useEffect(() => {
    setPixReceiptDraft(normalizePixReceiptConfig(state.pixReceiptConfig));
  }, [state.pixReceiptConfig]);

  useEffect(() => {
    if (hasPromptDraft) {
      toast.info(
        "Encontramos alterações não salvas nas instruções da IA. Revise e salve para não perdê-las.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!kindMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        kindMenuRef.current &&
        !kindMenuRef.current.contains(e.target as Node)
      ) {
        setKindMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [kindMenuOpen]);

  const handleCreateTrigger = async () => {
    if (!triggerInput.trim()) return;
    if (
      triggerKind === "redirect_contact" &&
      !normalizePhoneNumber(redirectPhone)
    ) {
      setTriggerLocalError("Informe o número para encaminhar o cliente.");
      return;
    }
    setTriggerBusy(true);
    setTriggerLocalError(null);
    try {
      await createTrigger(
        triggerInput.trim(),
        triggerKind,
        triggerKind === "redirect_contact" ? redirectPhone : null,
        triggerKind === "redirect_contact" ? redirectMessage : null,
      );
      setTriggerInput("");
      setTriggerKind("notify_manager");
      setRedirectPhone("");
      setRedirectMessage("");
    } catch (err) {
      setTriggerLocalError(
        err instanceof Error ? err.message : "Erro ao criar gatilho.",
      );
    } finally {
      setTriggerBusy(false);
    }
  };

  const applyRedirectTemplate = () => {
    setTriggerKind("redirect_contact");
    setTriggerInput(
      "Quando o cliente pedir para um número diferente, outra unidade ou pedir delivery",
    );
    setRedirectMessage(
      "Para pedidos de delivery, entre em contato pelo nosso número de entregas: {link} 🛵",
    );
    setKindMenuOpen(false);
    setTriggerLocalError(null);
  };

  const handleProcessContext = async () => {
    if (!managerInput.trim()) return;
    setIsProcessing(true);
    try {
      const newRules = await getOwnerResponse(managerInput);
      const newContexts = newRules.map((text: string) => ({
        id: Date.now().toString() + Math.random(),
        text,
      }));
      setState((prev) => ({
        ...prev,
        dailyContext: [...(prev.dailyContext || []), ...newContexts],
      }));
      setManagerInput("");
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGeneralManagerSend = async () => {
    if (isProcessing) return;
    const message = managerChatInput.trim();
    if (!message) return;
    if (!token) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: message,
      preview: message,
      kind: "text",
      timestamp: new Date().toISOString(),
    };
    // P2.22 — cap at 100 entries to prevent unbounded JSONB growth in empresa_perfil
    setState((prev) => ({
      ...prev,
      managerHistory: [...(prev.managerHistory || []), userMsg].slice(-100),
    }));
    setManagerChatInput("");
    setIsProcessing(true);
    try {
      const result = await sendManagerAssistantMessage(token, {
        message,
        history: state.managerHistory || [],
      });
      setState((prev) => ({
        ...prev,
        managerHistory: result.managerHistory.slice(-100),
        blockedDates: result.statePatch.blockedDates ?? prev.blockedDates,
        dailyContext: result.statePatch.dailyContext ?? prev.dailyContext,
        businessInfo: result.statePatch.businessInfo
          ? { ...prev.businessInfo, ...result.statePatch.businessInfo }
          : prev.businessInfo,
      }));
      if (result.statePatch.aiInstructionsDraft) {
        setPromptDraft(result.statePatch.aiInstructionsDraft);
        setPromptJustSaved(false);
        toast.info(
          "A IA preparou um rascunho de instruções. Revise e salve se estiver correto.",
        );
        promptRef.current?.focus();
      }
      if (result.statePatch.health) setAiHealth(result.statePatch.health);
      if (result.actionsApplied.length > 0) {
        toast.success(
          result.actionsApplied.map((action) => action.label).join(" · "),
        );
      }
      if (
        result.statePatch.notificationToggles ||
        result.statePatch.aiEnabled !== undefined
      ) {
        await refreshEmpresa?.();
      }
      void loadAiHealth();
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error
          ? e.message
          : "Tive um erro ao processar seu comando.",
      );
      setManagerChatInput(message);
      setState((prev) => ({
        ...prev,
        managerHistory: prev.managerHistory.filter(
          (msg) => msg.id !== userMsg.id,
        ),
      }));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSimulateAtendimento = async () => {
    const customerMessage = simulateInput.trim();
    if (!customerMessage) return;
    setSimulateLoading(true);
    setSimulateError(null);
    setSimulateResult(null);
    try {
      const result = await simulateAtendimento({
        customerMessage,
        customerName: "Cliente teste",
        configOverride: {
          aiInstructions: promptDraft,
        },
      });
      setSimulateResult(result);
    } catch (err) {
      setSimulateError(
        err instanceof Error ? err.message : "Falha ao simular atendimento.",
      );
    } finally {
      setSimulateLoading(false);
    }
  };

  const handleGeneratePrompt = async () => {
    setPromptGenerating(true);
    setPromptError(null);
    try {
      const generated = await generateAgentInstructions(
        promptDraft.trim() || undefined,
      );
      if (generated) {
        setPromptDraft(generated);
        setPromptJustSaved(false);
        promptRef.current?.focus();
      } else {
        setPromptError("A IA não retornou conteúdo. Tente novamente.");
      }
    } catch (err) {
      setPromptError(
        err instanceof Error ? err.message : "Falha ao gerar instruções.",
      );
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
        setState((prev) => ({ ...prev, aiInstructions: promptDraft }));
        clearPromptDraft();
        setPromptJustSaved(true);
        setTimeout(() => setPromptJustSaved(false), 2000);
      } else {
        setPromptError("Não foi possível salvar. Verifique sua conexão.");
      }
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setPromptSaving(false);
    }
  };

  const scheduleQrSave = (
    id: string,
    patch: Partial<Pick<QuickResponse, "trigger" | "response">>,
  ) => {
    if (qrDebounceRef.current[id]) clearTimeout(qrDebounceRef.current[id]);
    qrDebounceRef.current[id] = setTimeout(async () => {
      setQrSaveState((prev) => ({ ...prev, [id]: "saving" }));
      try {
        await updateQuickResponse(id, patch);
        setQrSaveState((prev) => ({ ...prev, [id]: "saved" }));
        setTimeout(
          () =>
            setQrSaveState((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            }),
          2000,
        );
      } catch (err) {
        // P1.35 — antes esse catch só limpava o save state visual e logava
        // no console. Operador via "Saving..." piscar e sumir, achava que
        // tinha salvo. Próxima vez que abria, mudança não estava lá. Agora
        // toast explícito + mantém o save state em "error" pra próximo
        // batch (futuro: visual badge de erro). Por enquanto: limpamos
        // estado mas mostramos toast.
        console.error("[AIConfigs] update QR failed:", err);
        toast.error("Não consegui salvar a resposta rápida. Tente de novo.");
        setQrSaveState((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }, 400);
  };

  const handleSavePixReceiptConfig = async () => {
    const normalized = normalizePixReceiptConfig(pixReceiptDraft);
    setPixReceiptSaving(true);
    try {
      const ok = await savePixReceiptConfig(normalized);
      if (!ok) throw new Error("save failed");
      setState((prev) => ({ ...prev, pixReceiptConfig: normalized }));
      await refreshEmpresa?.();
      await loadAiHealth();
      toast.success("Configuração de comprovante Pix salva.");
    } catch (err) {
      console.error("[AIConfigs] pix receipt save failed:", err);
      toast.error("Não consegui salvar a configuração do comprovante Pix.");
    } finally {
      setPixReceiptSaving(false);
    }
  };

  const booleanHealthItem = (
    label: string,
    healthValue: boolean | undefined,
    readyLabel: string,
    missingLabel = "Pendente",
  ): { label: string; value: string; tone: HealthTone } => ({
    label,
    value:
      healthValue === undefined
        ? "Verificando..."
        : healthValue
          ? readyLabel
          : missingLabel,
    tone: healthValue === undefined ? "neutral" : healthValue ? "ok" : "warn",
  });
  const aiHealthStatus = formatAiHealthStatus(aiHealth?.safeSummaryStatus);
  const healthItems: { label: string; value: string; tone: HealthTone }[] = [
    booleanHealthItem("Cardápio", aiHealth?.catalogLoaded, "Carregado"),
    booleanHealthItem(
      "Horários",
      aiHealth?.operatingHoursConfigured,
      "Configurados",
    ),
    booleanHealthItem(
      "Entrega",
      aiHealth?.deliveryConfigConfigured,
      "Configurada",
    ),
    booleanHealthItem(
      "Telefone do gerente",
      aiHealth?.managerPhonePresent,
      "Informado",
    ),
    booleanHealthItem("Pix", aiHealth?.pixPresent, "Informado"),
    {
      label: "Modo da IA",
      value: formatAiModeLabel(aiHealth?.aiMode),
      tone:
        aiHealth?.aiMode === "always_off"
          ? "warn"
          : aiHealth?.aiMode
            ? "ok"
            : "neutral",
    },
    {
      label: "Ativa agora",
      value:
        aiHealth === null
          ? "Verificando..."
          : aiHealth.aiEffectiveEnabledNow
            ? "Sim"
            : "Não",
      tone:
        aiHealth === null
          ? "neutral"
          : aiHealth.aiEffectiveEnabledNow
            ? "ok"
            : "neutral",
    },
    booleanHealthItem(
      "Comprovante Pix",
      aiHealth?.pixReceiptConfigured,
      aiHealth?.pixReceiptEnabled ? "Ativo" : "Desligado",
      "Pendente",
    ),
    {
      label: "Datas bloqueadas",
      value: aiHealth ? String(aiHealth.blockedDatesCount) : "Verificando...",
      tone: "neutral",
    },
    {
      label: "Status",
      value: aiHealthStatus.label,
      tone: aiHealthStatus.tone,
    },
  ];
  const selectedTriggerKind = triggerKindMeta(triggerKind);
  const SelectedTriggerIcon = selectedTriggerKind.Icon;
  const createTriggerDisabled =
    triggerBusy ||
    !triggerInput.trim() ||
    (triggerKind === "redirect_contact" &&
      !normalizePhoneNumber(redirectPhone));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1100px] mx-auto px-8 py-8 space-y-6">
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight">
            Cérebro IA
          </h1>
          <p className="text-[13px] text-[var(--color-ink-muted)]">
            Configure como a IA responde no WhatsApp e defina regras do negócio.
          </p>
        </header>

        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-line)]">
            <div className="flex items-center gap-2 min-w-0">
              <Activity
                className="w-4 h-4 text-[var(--color-ink-muted)] flex-shrink-0"
                strokeWidth={1.8}
              />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold">Saúde da IA</p>
                <p className="text-[11.5px] text-[var(--color-ink-muted)]">
                  Prontidão operacional do atendimento automático.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadAiHealth()}
              disabled={aiHealthLoading}
              className="h-8 w-8 rounded-md bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)] flex items-center justify-center hover:bg-[var(--color-line)] disabled:opacity-50 transition-colors"
              aria-label="Atualizar saúde da IA"
              title="Atualizar"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${aiHealthLoading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 px-4 py-2">
            {healthItems.map((item) => (
              <ReadinessItem key={item.label} {...item} />
            ))}
          </div>
          {aiHealthError && (
            <p className="px-4 pb-3 text-[11.5px] text-[var(--color-alert)]">
              {aiHealthError}
            </p>
          )}
        </div>

        {pixReceiptDraft.available && (
          <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
            <SectionHeader
              icon={ReceiptText}
              title="Confirmação por comprovante Pix"
              subtitle="A IA só finaliza pedidos Pix depois de conferir o comprovante enviado pelo cliente"
              action={
                <button
                  type="button"
                  onClick={() =>
                    setPixReceiptDraft((prev) => ({
                      ...prev,
                      enabled: !prev.enabled,
                    }))
                  }
                  className={`w-10 h-5 rounded-full relative transition-colors ${
                    pixReceiptDraft.enabled
                      ? "bg-[var(--color-brand)]"
                      : "bg-[var(--color-line-strong)]"
                  }`}
                  title={pixReceiptDraft.enabled ? "Desativar" : "Ativar"}
                >
                  <span
                    className={`absolute top-[2px] w-4 h-4 bg-white rounded-full shadow-sm transition-all ${
                      pixReceiptDraft.enabled ? "right-[2px]" : "left-[2px]"
                    }`}
                  />
                </button>
              }
            />
            <div className="p-4 space-y-4">
              <p className="text-[12.5px] text-[var(--color-ink-muted)] leading-relaxed">
                Leitura automática por imagem ou PDF. O sistema confere
                beneficiário, valor e data, mas não promete confirmação bancária
                de dinheiro recebido.
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-[12px] font-semibold text-[var(--color-ink-muted)]">
                    Nomes aceitos do beneficiário
                  </span>
                  <textarea
                    value={pixReceiptDraft.beneficiaryNames.join("\n")}
                    onChange={(e) =>
                      setPixReceiptDraft((prev) =>
                        normalizePixReceiptConfig({
                          ...prev,
                          beneficiaryNames: e.target.value.split("\n"),
                        }),
                      )
                    }
                    placeholder="Um nome por linha, como aparece no comprovante"
                    className={`${FIELD} min-h-[92px] resize-y`}
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-semibold text-[var(--color-ink-muted)]">
                      Tolerância de valor (R$)
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={pixReceiptDraft.valueTolerance}
                      onChange={(e) =>
                        setPixReceiptDraft((prev) =>
                          normalizePixReceiptConfig({
                            ...prev,
                            valueTolerance: Number(e.target.value),
                          }),
                        )
                      }
                      className={FIELD}
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-semibold text-[var(--color-ink-muted)]">
                      Validade do comprovante (h)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={pixReceiptDraft.maxAgeHours}
                      onChange={(e) =>
                        setPixReceiptDraft((prev) =>
                          normalizePixReceiptConfig({
                            ...prev,
                            maxAgeHours: Number(e.target.value),
                          }),
                        )
                      }
                      className={FIELD}
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-semibold text-[var(--color-ink-muted)]">
                      Se houver dúvida
                    </span>
                    <select
                      value={pixReceiptDraft.fallback}
                      onChange={(e) =>
                        setPixReceiptDraft((prev) =>
                          normalizePixReceiptConfig({
                            ...prev,
                            fallback: e.target.value,
                          }),
                        )
                      }
                      className={FIELD}
                    >
                      <option value="escalate_human">Chamar atendente</option>
                      <option value="ask_retry">Pedir outro comprovante</option>
                    </select>
                  </label>
                </div>
              </div>
              {pixReceiptDraft.enabled &&
                pixReceiptDraft.beneficiaryNames.length === 0 && (
                  <p className="text-[12px] text-[var(--color-alert)]">
                    Informe pelo menos um nome de beneficiário para ativar a
                    confirmação automática com segurança.
                  </p>
                )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSavePixReceiptConfig}
                  disabled={
                    pixReceiptSaving ||
                    (pixReceiptDraft.enabled &&
                      pixReceiptDraft.beneficiaryNames.length === 0)
                  }
                  className="h-9 px-3 rounded-md text-[12.5px] font-semibold flex items-center gap-1.5 bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink-soft)] disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                >
                  {pixReceiptSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Salvar comprovante Pix
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
          <SectionHeader
            icon={Bot}
            title="Simulador de atendimento"
            subtitle="Teste a resposta da IA sem enviar mensagem nem gravar pedido"
          />
          <div className="p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)] gap-4">
            <div className="space-y-2">
              <textarea
                value={simulateInput}
                onChange={(e) => setSimulateInput(e.target.value)}
                className="w-full min-h-[96px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-3 text-[13px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] resize-y transition-colors"
                placeholder='Ex: "vc pode mandar o cardapio?"'
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSimulateAtendimento}
                  disabled={simulateLoading || !simulateInput.trim()}
                  className="h-9 px-3 rounded-md text-[12.5px] font-semibold flex items-center gap-1.5 bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink-soft)] disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                >
                  {simulateLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  {simulateLoading ? "Simulando..." : "Simular"}
                </button>
                <p className="text-[11.5px] text-[var(--color-ink-faint)]">
                  Usa as instruções que estão no campo abaixo, mesmo antes de
                  salvar.
                </p>
              </div>
              {simulateError && (
                <p className="text-[12px] text-[var(--color-alert)]">
                  {simulateError}
                </p>
              )}
            </div>

            <div className="bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-3 min-h-[120px]">
              {!simulateResult && !simulateLoading ? (
                <p className="text-[12.5px] text-[var(--color-ink-faint)]">
                  O resultado aparece aqui.
                </p>
              ) : simulateLoading ? (
                <div className="h-full min-h-[90px] flex items-center justify-center text-[12.5px] text-[var(--color-ink-faint)]">
                  Processando simulação...
                </div>
              ) : simulateResult ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-semibold text-[var(--color-ink-faint)] mb-1">
                      Resposta
                    </p>
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                      {simulateResult.reply}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11.5px]">
                    <span
                      className={`px-2 py-1 rounded-md font-semibold ${
                        simulateResult.wouldCreateOrder
                          ? "bg-[var(--color-warn-soft)] text-[var(--color-warn)]"
                          : "bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]"
                      }`}
                    >
                      {simulateResult.wouldCreateOrder
                        ? "Criaria pedido"
                        : "Não criaria pedido"}
                    </span>
                    <span className="px-2 py-1 rounded-md bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink-muted)]">
                      Ferramentas:{" "}
                      {simulateResult.toolCallsMade.length
                        ? simulateResult.toolCallsMade.join(", ")
                        : "nenhuma"}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-[var(--color-ink-faint)]">
                    {simulateResult.simulationNote}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>

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
                    onClick={() =>
                      setState((prev) => ({ ...prev, dailyContext: [] }))
                    }
                    className="text-[11.5px] font-semibold text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)] px-2 py-1 rounded-md transition-colors"
                  >
                    Limpar
                  </button>
                ) : undefined
              }
            />
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {!state.dailyContext || state.dailyContext.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[var(--color-ink-faint)]">
                  <p className="text-[13px]">Nenhum aviso ativo.</p>
                  <p className="text-[12px] mt-1">
                    A lanchonete opera normalmente.
                  </p>
                </div>
              ) : (
                state.dailyContext.map((ctx) => (
                  <div
                    key={ctx.id}
                    className="flex gap-2 items-center bg-[var(--color-surface-muted)] border border-[var(--color-line)] px-3 py-2 rounded-lg group"
                  >
                    <span className="w-1.5 h-1.5 bg-[var(--color-brand)] rounded-full flex-shrink-0" />
                    <input
                      type="text"
                      value={ctx.text}
                      onChange={(e) =>
                        setState((prev) => ({
                          ...prev,
                          dailyContext: prev.dailyContext.map((c) =>
                            c.id === ctx.id
                              ? { ...c, text: e.target.value }
                              : c,
                          ),
                        }))
                      }
                      className="flex-1 bg-transparent outline-none text-[13px]"
                    />
                    <button
                      onClick={() =>
                        setState((prev) => ({
                          ...prev,
                          dailyContext: prev.dailyContext.filter(
                            (c) => c.id !== ctx.id,
                          ),
                        }))
                      }
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
                  onChange={(e) => setManagerInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleProcessContext()}
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
                state.managerHistory.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`text-[13px] px-3 py-2 rounded-lg max-w-[85%] ${
                        msg.role === "user"
                          ? "bg-[var(--color-ink)] text-white rounded-br-[4px]"
                          : "bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-bl-[4px]"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
              {isProcessing && (
                <div className="text-[12.5px] text-[var(--color-ink-faint)] italic">
                  IA digitando...
                </div>
              )}
            </div>
            <div className="p-3 border-t border-[var(--color-line)] bg-[var(--color-surface)]">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={managerChatInput}
                  onChange={(e) => setManagerChatInput(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleGeneralManagerSend()
                  }
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Macros */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden flex flex-col min-h-[280px]">
            <SectionHeader
              icon={Send}
              title="Respostas rápidas (atalhos)"
              subtitle="Use /GATILHO no chat para enviar instantaneamente — salvas automaticamente"
              action={
                <button
                  onClick={() => {
                    void addQuickResponse().catch((err) =>
                      console.error("[AIConfigs] add QR failed:", err),
                    );
                  }}
                  className="h-7 px-2.5 bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] rounded-md text-[12px] font-semibold flex items-center gap-1 hover:bg-[var(--color-line)] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>
              }
            />
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {quickResponses.length === 0 ? (
                <p className="text-[13px] text-center text-[var(--color-ink-faint)] mt-6">
                  Nenhum atalho configurado.
                </p>
              ) : (
                quickResponses.map((qr) => (
                  <div
                    key={qr.id}
                    className="group bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg overflow-hidden"
                  >
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="text-[12px] font-mono font-bold text-[var(--color-ink-muted)] flex-shrink-0">
                        /
                      </span>
                      <input
                        type="text"
                        defaultValue={qr.trigger}
                        onChange={(e) => {
                          const next = e.target.value.toUpperCase();
                          e.target.value = next;
                          scheduleQrSave(qr.id, { trigger: next });
                        }}
                        className="w-28 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2 py-1 text-[12.5px] font-semibold font-mono uppercase outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 flex-shrink-0"
                        placeholder="GATILHO"
                      />
                      <span className="flex-shrink-0 w-4 flex items-center justify-center ml-auto">
                        {qrSaveState[qr.id] === "saving" && (
                          <Loader2 className="w-3.5 h-3.5 text-[var(--color-ink-faint)] animate-spin" />
                        )}
                        {qrSaveState[qr.id] === "saved" && (
                          <Check className="w-3.5 h-3.5 text-[var(--color-brand)]" />
                        )}
                      </span>
                      <button
                        onClick={() => {
                          void deleteQuickResponse(qr.id).catch((err) =>
                            console.error("[AIConfigs] delete QR failed:", err),
                          );
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)] rounded-md transition-all flex-shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5 rotate-45" />
                      </button>
                    </div>
                    <div className="px-3 pb-2">
                      <input
                        type="text"
                        defaultValue={qr.response}
                        onChange={(e) =>
                          scheduleQrSave(qr.id, { response: e.target.value })
                        }
                        className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 focus:border-[var(--color-brand)] transition-colors"
                        placeholder="Texto da resposta..."
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right column: system triggers + custom triggers */}
          <div className="flex flex-col gap-5">
            <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
              <SectionHeader
                icon={Shield}
                title="Gatilhos automáticos do sistema"
                subtitle="Sempre ativos por padrão. Se desativar, a IA não vai mais escalar essas situações automaticamente."
              />
              <div className="p-3 space-y-2">
                {builtinTriggers.loading &&
                builtinTriggers.items.length === 0 ? (
                  <p className="text-[12.5px] text-center text-[var(--color-ink-faint)] py-2">
                    Carregando…
                  </p>
                ) : (
                  builtinTriggers.items.map((b) => (
                    <div
                      key={b.id}
                      className="bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-2.5 space-y-1"
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold uppercase tracking-wide flex-shrink-0 bg-[var(--color-warn-soft)] text-[var(--color-warn)]">
                          <Shield className="w-2.5 h-2.5" />
                          Sistema
                        </span>
                        <span className="flex-1 text-[12.5px] font-semibold text-[var(--color-ink)] min-w-0">
                          {b.name}
                        </span>
                        <button
                          onClick={() =>
                            void builtinTriggers
                              .setDisabled(b.id, !b.disabled)
                              .catch(() =>
                                toast.error(
                                  "Falha ao atualizar gatilho. Tente novamente.",
                                ),
                              )
                          }
                          className={`w-8 h-[18px] rounded-full relative flex-shrink-0 transition-colors ${
                            !b.disabled
                              ? "bg-[var(--color-brand)]"
                              : "bg-[var(--color-line-strong)]"
                          }`}
                          title={b.disabled ? "Ativar" : "Desativar"}
                        >
                          <span
                            className={`absolute top-[2px] w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all ${
                              !b.disabled ? "right-[2px]" : "left-[2px]"
                            }`}
                          />
                        </button>
                      </div>
                      <p className="text-[11.5px] text-[var(--color-ink-muted)] leading-relaxed">
                        {b.conditionDescription}
                      </p>
                    </div>
                  ))
                )}
                {builtinTriggers.error && (
                  <p className="text-[11px] text-[var(--color-alert)]">
                    {builtinTriggers.error}
                  </p>
                )}
              </div>
            </div>

            <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden flex flex-col min-h-[240px]">
              <SectionHeader
                icon={Bell}
                title="Gatilhos personalizados"
                subtitle="Descreva o comportamento em português"
              />
              <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {triggers.length === 0 ? (
                  <p className="text-[12.5px] text-center text-[var(--color-ink-faint)] mt-6 px-4">
                    Nenhum gatilho ainda. Descreva um cenário abaixo — a IA
                    extrai o que precisa.
                  </p>
                ) : (
                  triggers.map((t) => {
                    const meta = triggerKindMeta(t.kind);
                    const KindIcon = meta.Icon;
                    return (
                      <div
                        key={t.id}
                        className="group bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-2.5 space-y-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold uppercase tracking-wide flex-shrink-0 ${triggerKindTone(t.kind)}`}
                          >
                            <KindIcon className="w-2.5 h-2.5" />
                            {meta.label}
                          </span>
                          {t.kind === "redirect_contact" && (
                            <span className="text-[11px] text-[var(--color-ink-muted)] bg-[var(--color-surface)] border border-[var(--color-line)] rounded px-1.5 py-0.5 flex-shrink-0">
                              {formatRedirectPhonePreview(t.redirectPhone)}
                            </span>
                          )}
                          <input
                            value={t.name}
                            onChange={(e) =>
                              void updateTrigger(t.id, {
                                name: e.target.value,
                              }).catch(() =>
                                toast.error(
                                  "Não consegui salvar o nome do gatilho. Tente de novo.",
                                ),
                              )
                            }
                            className="flex-1 bg-transparent outline-none text-[12.5px] font-semibold min-w-0"
                          />
                          <button
                            onClick={() =>
                              void updateTrigger(t.id, {
                                active: !t.active,
                              }).catch(() =>
                                toast.error(
                                  "Não consegui ligar/desligar o gatilho.",
                                ),
                              )
                            }
                            className={`w-8 h-[18px] rounded-full relative flex-shrink-0 transition-colors ${
                              t.active
                                ? "bg-[var(--color-brand)]"
                                : "bg-[var(--color-line-strong)]"
                            }`}
                            title={t.active ? "Desativar" : "Ativar"}
                          >
                            <span
                              className={`absolute top-[2px] w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all ${
                                t.active ? "right-[2px]" : "left-[2px]"
                              }`}
                            />
                          </button>
                          <button
                            onClick={() =>
                              setDeletingTrigger({ id: t.id, name: t.name })
                            }
                            className="opacity-0 group-hover:opacity-100 p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-alert)] rounded transition-all"
                            title="Remover"
                          >
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                          </button>
                        </div>
                        <input
                          value={t.conditionDescription}
                          onChange={(e) =>
                            void updateTrigger(t.id, {
                              conditionDescription: e.target.value,
                            }).catch(() =>
                              toast.error(
                                "Não consegui salvar a descrição do gatilho.",
                              ),
                            )
                          }
                          className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2.5 py-1.5 text-[11.5px] text-[var(--color-ink-muted)] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 transition-colors"
                        />
                        {t.kind === "redirect_contact" && (
                          <div className="grid gap-1.5 sm:grid-cols-[minmax(150px,0.8fr)_minmax(180px,1.2fr)]">
                            <input
                              key={`${t.id}-phone-${t.redirectPhone ?? ""}`}
                              defaultValue={t.redirectPhone ?? ""}
                              onBlur={(e) =>
                                void updateTrigger(t.id, {
                                  redirectPhone: e.target.value,
                                }).catch(() =>
                                  toast.error(
                                    "Não consegui salvar o número de encaminhamento.",
                                  ),
                                )
                              }
                              placeholder="(XX) XXXXX-XXXX ou 55XXXXXXXXXXX"
                              className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2.5 py-1.5 text-[11.5px] text-[var(--color-ink-muted)] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 transition-colors"
                            />
                            <input
                              key={`${t.id}-message-${t.redirectMessage ?? ""}`}
                              defaultValue={t.redirectMessage ?? ""}
                              onBlur={(e) =>
                                void updateTrigger(t.id, {
                                  redirectMessage: e.target.value,
                                }).catch(() =>
                                  toast.error(
                                    "Não consegui salvar a mensagem de encaminhamento.",
                                  ),
                                )
                              }
                              placeholder="Para isto, fale conosco aqui: {link}"
                              className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2.5 py-1.5 text-[11.5px] text-[var(--color-ink-muted)] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 transition-colors"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="p-3 border-t border-[var(--color-line)] bg-[var(--color-surface)] space-y-1.5">
                {(triggerLocalError || triggersError) && (
                  <p className="text-[11px] text-[var(--color-alert)]">
                    {triggerLocalError ?? triggersError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={applyRedirectTemplate}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-[var(--color-surface-muted)] text-[12px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-line)] transition-colors"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  Encaminhar para outra linha
                </button>
                <div className="flex gap-2">
                  <div className="relative" ref={kindMenuRef}>
                    <button
                      type="button"
                      onClick={() => setKindMenuOpen((o) => !o)}
                      className={`h-10 px-2.5 rounded-lg flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide transition-colors ${triggerKindTone(triggerKind)} hover:brightness-95`}
                    >
                      <SelectedTriggerIcon className="w-3 h-3" />
                      {selectedTriggerKind.label}
                      <ChevronDown className="w-3 h-3 opacity-70" />
                    </button>
                    {kindMenuOpen && (
                      <div className="absolute bottom-full left-0 mb-1 z-10 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg shadow-lg overflow-hidden min-w-[260px]">
                        {TRIGGER_KIND_OPTIONS.map(
                          ({ kind: k, label, description, Icon }) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => {
                                setTriggerKind(k);
                                setKindMenuOpen(false);
                              }}
                              className={`w-full flex items-start gap-2 px-2.5 py-2 text-left hover:bg-[var(--color-surface-muted)] transition-colors ${
                                k === "escalate_human"
                                  ? "text-[var(--color-warn)]"
                                  : "text-[var(--color-brand-deep)]"
                              }`}
                            >
                              <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                              <span className="flex-1 min-w-0">
                                <span className="block text-[12px] font-semibold uppercase tracking-wide">
                                  {label}
                                </span>
                                <span className="block text-[11px] normal-case font-normal text-[var(--color-ink-muted)] leading-snug">
                                  {description}
                                </span>
                              </span>
                              {triggerKind === k && (
                                <Check className="w-3 h-3 mt-0.5 flex-shrink-0" />
                              )}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  <input
                    value={triggerInput}
                    onChange={(e) => setTriggerInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleCreateTrigger()
                    }
                    placeholder='Ex: "avise o gerente se pedirem mais de R$200"'
                    className={`${FIELD} flex-1`}
                  />
                  <button
                    onClick={handleCreateTrigger}
                    disabled={createTriggerDisabled}
                    className="h-10 w-10 rounded-lg bg-[var(--color-ink)] text-white flex items-center justify-center disabled:opacity-40 hover:bg-[var(--color-ink-soft)] transition-colors"
                  >
                    {triggerBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {triggerKind === "redirect_contact" && (
                  <div className="grid gap-2 sm:grid-cols-[minmax(190px,0.8fr)_minmax(240px,1.2fr)]">
                    <label className="space-y-1">
                      <span className="text-[11.5px] font-semibold text-[var(--color-ink-muted)]">
                        Número para encaminhar *
                      </span>
                      <input
                        value={redirectPhone}
                        onChange={(e) => setRedirectPhone(e.target.value)}
                        placeholder="(XX) XXXXX-XXXX ou 55XXXXXXXXXXX"
                        className={FIELD}
                      />
                      <span className="block text-[11px] text-[var(--color-ink-faint)]">
                        DDD + número. O link será gerado automaticamente.
                      </span>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11.5px] font-semibold text-[var(--color-ink-muted)]">
                        Mensagem de encaminhamento
                      </span>
                      <textarea
                        value={redirectMessage}
                        onChange={(e) => setRedirectMessage(e.target.value)}
                        placeholder="Para isto, fale conosco aqui: {link}"
                        rows={2}
                        className={`${FIELD} resize-none min-h-[72px]`}
                      />
                      <span className="block text-[11px] text-[var(--color-ink-faint)]">
                        Use {"{link}"} onde o WhatsApp deve aparecer. Padrão:{" "}
                        {REDIRECT_DEFAULT_MESSAGE}
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tags de Atendimento */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
          <SectionHeader
            icon={TagIcon}
            title="Tags de atendimento"
            subtitle="Classifique conversas e deixe o robô marcar sozinho por tipo de cliente (ex: delivery, retirada)"
            action={
              <button
                onClick={() => {
                  setEditingTag(null);
                  setTagForm({
                    name: "",
                    color: TAG_COLORS[0],
                    aiInstructions: "",
                    autoApplyCondition: "",
                  });
                }}
                className="h-7 px-2.5 bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] rounded-md text-[12px] font-semibold flex items-center gap-1 hover:bg-[var(--color-line)] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Nova tag
              </button>
            }
          />
          <div className="p-3 space-y-2">
            {tags.length === 0 && !tagForm && (
              <p className="text-[13px] text-center text-[var(--color-ink-faint)] py-4">
                Nenhuma tag criada. Crie tags para classificar clientes por
                perfil.
              </p>
            )}
            {!tagForm &&
              !editingTag &&
              AUTO_TAG_TEMPLATES.some(
                (tpl) =>
                  !tags.some(
                    (t) => t.name.toLowerCase() === tpl.name.toLowerCase(),
                  ),
              ) && (
                <div className="flex flex-wrap items-center gap-1.5 pb-1">
                  <span className="text-[11px] text-[var(--color-ink-faint)] mr-0.5">
                    Modelos prontos:
                  </span>
                  {AUTO_TAG_TEMPLATES.filter(
                    (tpl) =>
                      !tags.some(
                        (t) => t.name.toLowerCase() === tpl.name.toLowerCase(),
                      ),
                  ).map((tpl) => (
                    <button
                      key={tpl.name}
                      onClick={() => {
                        setEditingTag(null);
                        setTagForm({
                          name: tpl.name,
                          color: tpl.color,
                          aiInstructions: tpl.aiInstructions,
                          autoApplyCondition: tpl.autoApplyCondition,
                        });
                      }}
                      className="h-6 px-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-muted)] text-[11.5px] font-medium text-[var(--color-ink-soft)] flex items-center gap-1 hover:border-[var(--color-brand)] transition-colors"
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: tpl.color }}
                      />
                      {tpl.name}
                    </button>
                  ))}
                </div>
              )}
            {tags.map((tag) =>
              editingTag?.id === tag.id ? (
                <div
                  key={tag.id}
                  className="bg-[var(--color-surface-muted)] border border-[var(--color-brand)] rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={tagForm?.name ?? tag.name}
                      onChange={(e) =>
                        setTagForm((f) =>
                          f ? { ...f, name: e.target.value } : null,
                        )
                      }
                      className="flex-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2 py-1 text-[13px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20"
                      placeholder="Nome da tag"
                    />
                    <div className="flex gap-1">
                      {TAG_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() =>
                            setTagForm((f) => (f ? { ...f, color: c } : null))
                          }
                          className="w-5 h-5 rounded-full border-2 transition-all"
                          style={{
                            backgroundColor: c,
                            borderColor:
                              tagForm?.color === c
                                ? "var(--color-ink)"
                                : "transparent",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-[var(--color-ink-soft)]">
                      Marcar automaticamente quando… (opcional)
                    </label>
                    <textarea
                      value={
                        tagForm?.autoApplyCondition ??
                        tag.autoApplyCondition ??
                        ""
                      }
                      onChange={(e) =>
                        setTagForm((f) =>
                          f
                            ? { ...f, autoApplyCondition: e.target.value }
                            : null,
                        )
                      }
                      rows={2}
                      maxLength={500}
                      className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 resize-none"
                      placeholder="Ex: o cliente pedir entrega ou informar que vai retirar no local"
                    />
                    <p className="text-[10.5px] text-[var(--color-ink-faint)]">
                      Descreva com suas palavras. Deixe em branco para marcar só
                      na mão.
                    </p>
                  </div>
                  <div className="relative space-y-1">
                    <label className="text-[11px] font-semibold text-[var(--color-ink-soft)]">
                      O que o robô faz quando a conversa tem esta tag (opcional)
                    </label>
                    <textarea
                      value={
                        tagForm?.aiInstructions ?? tag.aiInstructions ?? ""
                      }
                      onChange={(e) =>
                        setTagForm((f) =>
                          f ? { ...f, aiInstructions: e.target.value } : null,
                        )
                      }
                      rows={3}
                      maxLength={1000}
                      className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 resize-none"
                      placeholder="Ex: orientar o cliente com uma mensagem específica para esta tag"
                    />
                    <span className="absolute bottom-1.5 right-2 text-[10px] text-[var(--color-ink-faint)]">
                      {
                        (tagForm?.aiInstructions ?? tag.aiInstructions ?? "")
                          .length
                      }
                      /1000
                    </span>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        setEditingTag(null);
                        setTagForm(null);
                      }}
                      className="h-7 px-3 rounded-md text-[12px] font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]"
                    >
                      Cancelar
                    </button>
                    <button
                      disabled={tagBusy || !tagForm?.name?.trim()}
                      onClick={async () => {
                        if (!tagForm?.name?.trim()) return;
                        setTagBusy(true);
                        try {
                          await updateTagFn(tag.id, {
                            name: tagForm.name,
                            color: tagForm.color,
                            aiInstructions: tagForm.aiInstructions || null,
                            autoApplyCondition:
                              tagForm.autoApplyCondition || null,
                          });
                          toast.success("Tag atualizada.");
                          setEditingTag(null);
                          setTagForm(null);
                        } catch {
                          toast.error("Erro ao salvar tag.");
                        } finally {
                          setTagBusy(false);
                        }
                      }}
                      className="h-7 px-3 rounded-md text-[12px] font-semibold bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink-soft)] disabled:opacity-50 flex items-center gap-1"
                    >
                      {tagBusy ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Check className="w-3 h-3" />
                      )}
                      Salvar
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={tag.id}
                  className="group flex items-start gap-2.5 bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-2.5"
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: tag.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[var(--color-ink)] flex items-center gap-1.5">
                      {tag.name}
                      {tag.autoApplyCondition && (
                        <span className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
                          auto
                        </span>
                      )}
                    </p>
                    {tag.autoApplyCondition && (
                      <p className="text-[11px] text-[var(--color-ink-faint)] truncate">
                        Marca quando: {tag.autoApplyCondition}
                      </p>
                    )}
                    {tag.aiInstructions && (
                      <p className="text-[11.5px] text-[var(--color-ink-muted)] truncate">
                        {tag.aiInstructions}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        setEditingTag(tag);
                        setTagForm({
                          name: tag.name,
                          color: tag.color,
                          aiInstructions: tag.aiInstructions ?? "",
                          autoApplyCondition: tag.autoApplyCondition ?? "",
                        });
                      }}
                      className="p-1 rounded-md text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:bg-[var(--color-line)]"
                    >
                      <Save className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeletingTag(tag)}
                      className="p-1 rounded-md text-[var(--color-ink-faint)] hover:text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ),
            )}
            {/* New tag form */}
            {tagForm && !editingTag && (
              <div className="bg-[var(--color-surface-muted)] border border-[var(--color-brand)] rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={tagForm.name}
                    onChange={(e) =>
                      setTagForm((f) =>
                        f ? { ...f, name: e.target.value } : null,
                      )
                    }
                    className="flex-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2 py-1 text-[13px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20"
                    placeholder="Nome da tag (ex: Cliente VIP)"
                  />
                  <div className="flex gap-1">
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() =>
                          setTagForm((f) => (f ? { ...f, color: c } : null))
                        }
                        className="w-5 h-5 rounded-full border-2 transition-all"
                        style={{
                          backgroundColor: c,
                          borderColor:
                            tagForm.color === c
                              ? "var(--color-ink)"
                              : "transparent",
                        }}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => setTagForm(null)}
                    className="p-1 rounded-md text-[var(--color-ink-faint)] hover:bg-[var(--color-line)]"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-[var(--color-ink-soft)]">
                    Marcar automaticamente quando… (opcional)
                  </label>
                  <textarea
                    value={tagForm.autoApplyCondition}
                    onChange={(e) =>
                      setTagForm((f) =>
                        f ? { ...f, autoApplyCondition: e.target.value } : null,
                      )
                    }
                    rows={2}
                    maxLength={500}
                    className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 resize-none"
                    placeholder="Ex: o cliente pedir entrega ou informar que vai retirar no local"
                  />
                  <p className="text-[10.5px] text-[var(--color-ink-faint)]">
                    Descreva com suas palavras. Deixe em branco para marcar só
                    na mão.
                  </p>
                </div>
                <div className="relative space-y-1">
                  <label className="text-[11px] font-semibold text-[var(--color-ink-soft)]">
                    O que o robô faz quando a conversa tem esta tag (opcional)
                  </label>
                  <textarea
                    value={tagForm.aiInstructions}
                    onChange={(e) =>
                      setTagForm((f) =>
                        f ? { ...f, aiInstructions: e.target.value } : null,
                      )
                    }
                    rows={3}
                    maxLength={1000}
                    className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 resize-none"
                    placeholder="Ex: orientar o cliente com uma mensagem específica para esta tag"
                  />
                  <span className="absolute bottom-1.5 right-2 text-[10px] text-[var(--color-ink-faint)]">
                    {tagForm.aiInstructions.length}/1000
                  </span>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setTagForm(null)}
                    className="h-7 px-3 rounded-md text-[12px] font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={tagBusy || !tagForm.name.trim()}
                    onClick={async () => {
                      if (!tagForm.name.trim()) return;
                      setTagBusy(true);
                      try {
                        await createTag({
                          name: tagForm.name,
                          color: tagForm.color,
                          aiInstructions: tagForm.aiInstructions || null,
                          autoApplyCondition:
                            tagForm.autoApplyCondition || null,
                        });
                        toast.success(`Tag "${tagForm.name}" criada.`);
                        setTagForm(null);
                      } catch {
                        toast.error("Erro ao criar tag.");
                      } finally {
                        setTagBusy(false);
                      }
                    }}
                    className="h-7 px-3 rounded-md text-[12px] font-semibold bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink-soft)] disabled:opacity-50 flex items-center gap-1"
                  >
                    {tagBusy ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                    Criar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tag delete confirm */}
        {deletingTag && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl shadow-[var(--shadow-pop)] p-6 w-[340px] max-w-[calc(100vw-2rem)] space-y-4">
              <p className="text-[14px] font-semibold text-[var(--color-ink)]">
                Remover tag "{deletingTag.name}"?
              </p>
              <p className="text-[13px] text-[var(--color-ink-muted)]">
                A tag será removida de todas as conversas onde estiver aplicada.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDeletingTag(null)}
                  className="h-8 px-3 rounded-md text-[13px] font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]"
                >
                  Cancelar
                </button>
                <button
                  disabled={tagBusy}
                  onClick={async () => {
                    setTagBusy(true);
                    try {
                      await deleteTagFn(deletingTag.id);
                      toast.success(`Tag "${deletingTag.name}" removida.`);
                      setDeletingTag(null);
                    } catch {
                      toast.error("Erro ao remover tag.");
                    } finally {
                      setTagBusy(false);
                    }
                  }}
                  className="h-8 px-3 rounded-md text-[13px] font-semibold bg-[var(--color-alert)] text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                >
                  {tagBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : null}
                  Remover
                </button>
              </div>
            </div>
          </div>
        )}

        {/* System Prompt */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-line)]">
            <div className="flex items-center gap-2 min-w-0">
              <AlignLeft
                className="w-4 h-4 text-[var(--color-ink-muted)] flex-shrink-0"
                strokeWidth={1.8}
              />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold">
                  Instruções base do agente
                </p>
                <p className="text-[11.5px] text-[var(--color-ink-muted)]">
                  O prompt mestre que define a personalidade e as regras
                  absolutas da IA.
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
                {promptGenerating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {promptGenerating ? "Gerando..." : "Gerar com IA"}
              </button>
              <button
                onClick={handleSavePrompt}
                disabled={
                  promptSaving ||
                  promptGenerating ||
                  (!promptDirty && !promptJustSaved)
                }
                className={`h-8 px-3 rounded-md text-[12px] font-semibold flex items-center gap-1.5 transition-colors ${
                  promptJustSaved
                    ? "bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]"
                    : promptDirty
                      ? "bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink-soft)]"
                      : "bg-[var(--color-surface-muted)] text-[var(--color-ink-faint)]"
                } disabled:cursor-not-allowed`}
              >
                {promptSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : promptJustSaved ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {promptSaving
                  ? "Salvando..."
                  : promptJustSaved
                    ? "Salvo"
                    : "Salvar"}
              </button>
            </div>
          </div>
          <div className="p-4 space-y-2">
            <textarea
              ref={promptRef}
              className="w-full min-h-[320px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-4 text-[13px] font-mono outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] resize-y leading-relaxed transition-colors"
              value={promptDraft}
              onChange={(e) => {
                setPromptDraft(e.target.value);
                setPromptJustSaved(false);
              }}
              placeholder="Descreva como sua IA deve falar, o tom, limites e prioridades — ou clique em Gerar com IA."
            />
            {promptError && (
              <p className="text-[12px] text-[var(--color-alert)]">
                {promptError}
              </p>
            )}
            <p className="text-[11.5px] text-[var(--color-ink-faint)]">
              Salvo no banco por empresa — a IA do WhatsApp usa este texto
              automaticamente ao responder clientes.
            </p>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={deletingTrigger !== null}
        title="Remover gatilho?"
        message={`Remover o gatilho "${deletingTrigger?.name}"? Esta ação não pode ser desfeita.`}
        onClose={() => setDeletingTrigger(null)}
        onConfirm={async () => {
          await deleteTrigger(deletingTrigger!.id);
          toast.success(`Gatilho "${deletingTrigger!.name}" removido.`);
        }}
        confirmLabel="Remover"
        confirmLoadingLabel="Removendo..."
      />
    </div>
  );
};
