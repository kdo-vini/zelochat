/**
 * Conversation/order state utilities — DETERMINISTIC, NO AI.
 *
 * Lives in /domain because the rules below are part of the product, not the
 * UI or the OpenAI prompt. Anything in here must be:
 *
 *   • pure (no DB, no fetch, no globals)
 *   • exhaustively unit-tested (tests/conversationState.test.ts)
 *   • runnable in both browser and Node (no Express/Supabase imports)
 *
 * The functions encode three production-incident-driven rules:
 *
 *   1. Informal confirmations after an order summary ("certinho", "gratidão",
 *      "boa noite e até amanhã", 👍, 🙏) — these were treated as "edit intent"
 *      and bounced the customer back into AI clarification, instead of being
 *      recognized as a confirmation. classifyConfirmationIntent() answers that.
 *
 *   2. After AI auto-reactivates from manual/off mode, a customer message
 *      that is just an attachment (image/PDF) or a thank-you must NOT
 *      restart the order flow — the AI was off while a human handled the
 *      order, the order is already in zelochat_orders, the attachment is the
 *      Pix receipt for that already-confirmed order.
 *      isLikelyPaymentProofMessage() detects that case so the caller can
 *      look up an active order and treat the message as a receipt
 *      acknowledgement instead of a new conversation.
 *
 *   3. "Salgados fritos / mini fritos / fritinhos" → mini fried salgados
 *      ("Cento Sortidos", "Cento Tradicionais Sortidos", "Cento de Bolinha
 *      de queijo", etc.). When the AI sends an unmatchable product name but
 *      the customer's intent maps to a known category, we should ask a
 *      clarification question (with concrete candidates) instead of
 *      escalating "Produto não encontrado com segurança".
 *      mapInformalSalgadoTerm() + resolveProductBySemantic() handle that.
 */

export type SemanticCategory =
  | 'salgado_frito_mini'
  | 'salgado_assado_mini'
  | 'salgado_sortido_mini'
  | 'doce_mini'
  | 'bolo'
  | 'bebida';

export type SemanticMode = 'fritos' | 'assados' | 'sortidos' | null;

export interface SemanticIntent {
  /** Categories the customer likely referred to. May be empty. */
  categories: SemanticCategory[];
  /** "fritos" / "assados" / "sortidos" — null when not specified. */
  mode: SemanticMode;
  /** Number of UNITS the customer asked for (e.g. "meio cento" → 50). null if not stated. */
  units: number | null;
  /** Specific salgado names the customer mentioned ("bolinha de queijo", "frango"). */
  flavorHints: string[];
}

export type ConfirmationIntent =
  | 'affirmative_confirm'
  | 'negative_cancel'
  | 'farewell_or_thanks_confirm'
  | 'emoji_only_confirm'
  | 'escalation_request'
  | 'edit_intent'
  | 'unknown';

export interface ClassifyContext {
  /**
   * What the AI's most recent assistant message was asking. The classifier
   * is context-aware: "não" answering "quer alterar algo?" means "no
   * changes" (confirmation), but "não" with no pending question means
   * cancellation/disagreement.
   */
  lastAiQuestion?:
    | 'observation_or_change'   // "Gostaria de alterar algo, ou tem alguma observação a fazer?"
    | 'confirm_order_summary'   // sent the order summary, asking confirm
    | 'pending_button_confirm'  // sent the buttons, awaiting tap
    | 'none';
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const EMOJI_AFFIRMATIVE = new Set<string>([
  '\u{1F44D}', // 👍
  '\u{1F64F}', // 🙏
  '✅',    // ✅
  '\u{1F197}', // 🆗
  '\u{1F44C}', // 👌
  '☑',    // ☑
]);

const EMOJI_NEGATIVE = new Set<string>([
  '❌', // ❌
  '\u{1F44E}', // 👎
  '\u{1F645}', // 🙅
]);

function isEmoji(ch: string): boolean {
  // Quick filter — any non-ASCII non-letter codepoint is treated as a symbol.
  return /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{So}]/u.test(ch);
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '');
}

/** lowercase + strip diacritics + collapse whitespace + drop trailing punct/emoji */
export function normalizeIntent(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[\s ]+/g, ' ')
    .replace(/[\s\p{P}\p{S}]+$/u, '')
    .replace(/^[\s\p{P}\p{S}]+/u, '')
    .trim();
}

/** Like normalizeIntent but preserves internal punctuation as spaces. */
export function normalizeLoose(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[\p{S}\p{P}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns the codepoints in the string, used for emoji-only detection. */
function codepoints(s: string): string[] {
  return Array.from(s);
}

// ---------------------------------------------------------------------------
// Confirmation intent classifier
// ---------------------------------------------------------------------------

const AFFIRMATIVE_TOKENS = new Set<string>([
  // explicit yes
  'sim', 's', 'ss', 'simm', 'simmm', 'sii', 'siii', 'isso', 'isso ai', 'isso ae', 'isso mesmo',
  // ok variants
  'ok', 'okay', 'okk', 'oki', 'okei', 'okidoki',
  // confirma
  'confirmar', 'confirma', 'confirmo', 'confirmado', 'confirmadinho', 'confirmadoo',
  // beleza
  'beleza', 'blz', 'bele', 'belezura',
  // fechado
  'fechado', 'fechou', 'fechadinho', 'fechadissimo',
  // perfeito / certo
  'perfeito', 'perfeita', 'perfeitinho',
  'otimo', 'otima', 'exato', 'exatamente',
  'certo', 'certa', 'certinho', 'certinha', 'certim', 'certissimo', 'tudo certo', 'ta certo', 'ta certinho',
  // pode
  'pode', 'pode ser', 'pode mandar', 'pode confirmar', 'pode finalizar', 'pode fechar', 'pode crer',
  // manda
  'manda', 'manda ai', 'manda ae', 'manda ver', 'mandou bem',
  // misc
  'vai sim', 'claro', 'com certeza', 'certeza', 'show', 'show de bola', 'dale', 'dahora', 'demorou',
  'combinado', 'combinadissimo', 'tranquilo', 'tranquilao', 'suave', 'tamo junto',
  'massa', 'top', 'topissimo', 'firmeza', 'firme',
  'ta bom', 'tabom', 'ta bem', 'esta bom', 'esta certo',
  'concordo', 'aprovado', 'aceito',
  // gratitude / farewell that imply "no changes"
  'obrigado', 'obrigada', 'obg', 'obgd', 'obrigadao', 'obrigadinho',
  'valeu', 'vlw', 'vlww', 'gratidao', 'grato', 'grata', 'agradecido', 'agradecida',
  'falou', 'flw', 'flww',
  'boa noite', 'bom dia', 'boa tarde',
  'ate amanha', 'ate mais', 'ate logo', 'ate breve', 'ate ja',
  'boa noite ate amanha', 'boa noite e ate amanha', 'ate amanha entao',
  'tudo bem entao', 'tudo joia', 'tudo tranquilo',
]);

const NEGATIVE_TOKENS = new Set<string>([
  'nao', 'n', 'nn', 'naoo', 'nao quero', 'nao precisa',
  'no', 'nop', 'nope',
  'cancelar', 'cancela', 'cancelo', 'cancelado', 'cancela ai', 'cancela tudo',
  'desistir', 'desisto', 'desiste', 'mudei de ideia',
  'esquece', 'esquecer', 'deixa pra la', 'deixa pra outro dia',
  'para', 'pare', 'parar', 'pode parar',
]);

const NO_CHANGE_TOKENS = new Set<string>([
  'nada',
  'nada nao',
  'sem obs',
  'sem observacao',
  'sem observacoes',
  'sem alteracao',
  'sem alteracoes',
  'sem mudar nada',
  'sem mexer',
  'nao muda nada',
  'nao precisa alterar',
  'nao precisa mudar',
  'nao altera nada',
  'nao mexe nao',
  'deixa como ta',
  'deixa assim',
  'pode deixar assim',
  'ta bom assim',
  'desse jeito',
  'do jeito que ta',
]);

const ESCALATION_PATTERNS: RegExp[] = [
  /\b(humano|atendente|gerente|pessoa real|alguem de verdade|falar com alguem|chama alguem|chamar alguem|fala com alguem)\b/u,
  /\b(reclam\w*|insatisfeit\w*|pessim\w*|horrivel|veio errado|veio sem|faltou|demorou demais|atrasou|nao chegou)\b/u,
  /\b(reembols\w*|estorn\w*|devoluc\w*|dinheiro de volta)\b/u,
  /\b(ofens\w*|xing\w*|palavr\w+ao|idiot\w+|burro|merda|porra|caralho|raiva|irritad\w+|nervos\w+)\b/u,
];

function looksLikeEscalation(value: string): boolean {
  const norm = normalizeLoose(value);
  if (!norm) return false;
  return ESCALATION_PATTERNS.some((re) => re.test(norm));
}

/**
 * Markers that signal "yes BUT change something" or "no, I'd rather". When
 * present alongside a confirmation/cancel token, the reply is ambiguous and
 * the caller should fall through to AI clarification rather than auto-act.
 *
 * Conservative on purpose: false negatives just mean the existing token
 * match runs (still safe — auto-confirm only fires for unambiguous tokens),
 * false positives bounce a clear confirmation back into edit clarification
 * (annoying). Keep these unmistakable.
 */
const QUALIFIER_PATTERNS: RegExp[] = [
  /\bmas\b/u,
  /\bporem\b/u,
  /\bso que\b/u,
  /\bprefir\w+\b/u,
  /\bpreferi\w*\b/u,
  /\bmelhor\b/u,
  /\bao inves\b/u,
  /\bem vez\b/u,
  /\btroca\w*\b/u,
  /\btirar?\b/u,
  /\bsubstitu\w+\b/u,
];

function hasContradictionMarker(value: string): boolean {
  const norm = normalizeLoose(value);
  if (!norm) return false;
  return QUALIFIER_PATTERNS.some((re) => re.test(norm));
}

function looksLikeNoChangeReply(value: string): boolean {
  const norm = normalizeLoose(value);
  if (!norm) return false;
  if (NO_CHANGE_TOKENS.has(norm)) return true;
  return /\b(sem|nenhuma?)\s+(obs|observacao|observacoes|alteracao|alteracoes)\b/u.test(norm)
    || /\bnao\s+(muda|alter[ae]|mexe)\s+nada\b/u.test(norm)
    || /\b(deixa|pode deixar)\s+(como\s+ta|assim|desse jeito)\b/u.test(norm);
}

function looksLikePendingEditRequest(value: string): boolean {
  const norm = normalizeLoose(value);
  if (!norm) return false;
  return /\b(troca|trocar|troque|muda|mudar|altera|alterar|ajusta|ajustar|corrige|corrigir|edita|editar)\b/u.test(norm)
    || /\b(tira|tirar|remove|remover|sem|com|adiciona|adicionar|inclui|incluir|coloca|colocar|bota|botar)\b/u.test(norm)
    || /\b(cancelar|cancela)\s+(so|apenas|somente)\b/u.test(norm)
    || /\b(cancelar|cancela)\s+(?!o pedido\b|pedido\b|tudo\b)(a|o|as|os|essa|esse|essas|esses|uma|um)\b/u.test(norm)
    || /\b(retirada|entrega|delivery|endereco|bairro|troco|pagamento|pix|cartao|dinheiro|horario|hora|manha|tarde|noite)\b/u.test(norm)
    || /\b(confirmar|confirma)\s+(mais tarde|depois|so se|quando)\b/u.test(norm);
}

const CONFIRMATION_FILLER_TOKENS = new Set<string>([
  'ai',
  'ae',
  'aew',
  'entao',
  'e',
  'por',
  'favor',
  'pfv',
  'porfa',
  'so',
  'muito',
  'mesmo',
  'ta',
  'tá',
]);

function hasOnlyConfirmationFillers(tokens: string[], matched: Set<number>): boolean {
  return tokens
    .filter((_, idx) => !matched.has(idx))
    .every((token) => CONFIRMATION_FILLER_TOKENS.has(token));
}

/**
 * Classifies a customer reply text into a confirmation intent.
 *
 * Context matters: "não" after the AI asked "quer alterar algo?" is a
 * confirmation (no changes). "não" with no pending question is a cancellation.
 *
 * The function returns "unknown" generously — false negatives only mean the
 * caller falls back to the default flow (route to AI, ask clarification).
 * False positives auto-confirm/auto-cancel real money, so the sets stay
 * conservative.
 */
export function classifyConfirmationIntent(
  raw: string,
  context: ClassifyContext = { lastAiQuestion: 'none' },
): ConfirmationIntent {
  const text = (raw ?? '').trim();
  if (!text) return 'unknown';

  if (looksLikeEscalation(text)) return 'escalation_request';

  // Emoji-only path — strip whitespace and check whether every remaining
  // codepoint is in our affirmative/negative emoji sets.
  const compact = text.replace(/\s+/g, '');
  const cps = codepoints(compact);
  if (cps.length > 0 && cps.every((c) => isEmoji(c) || /[\p{S}\p{P}]/u.test(c))) {
    const positives = cps.filter((c) => EMOJI_AFFIRMATIVE.has(c));
    const negatives = cps.filter((c) => EMOJI_NEGATIVE.has(c));
    if (negatives.length > 0 && positives.length === 0) return 'negative_cancel';
    if (positives.length > 0 && negatives.length === 0) {
      // Emoji-only positive on its own is enough only when a confirmation
      // is actually pending. Otherwise it's just a friendly reaction.
      if (context.lastAiQuestion && context.lastAiQuestion !== 'none') {
        return 'emoji_only_confirm';
      }
      return 'unknown';
    }
    return 'unknown';
  }

  const normalized = normalizeIntent(text);
  if (!normalized) return 'unknown';

  if (context.lastAiQuestion === 'observation_or_change' && looksLikeNoChangeReply(text)) {
    return 'farewell_or_thanks_confirm';
  }

  // Single-token exact-match path runs unchanged. A user typing JUST "não" or
  // JUST "certo" is unambiguous; the contradiction-marker check below only
  // applies when the message has additional content beyond the token.
  if (NEGATIVE_TOKENS.has(normalized)) {
    if (context.lastAiQuestion === 'observation_or_change') {
      return 'farewell_or_thanks_confirm';
    }
    return 'negative_cancel';
  }
  if (AFFIRMATIVE_TOKENS.has(normalized)) {
    if (
      context.lastAiQuestion === 'observation_or_change' &&
      isFarewellOrThanks(normalized)
    ) {
      return 'farewell_or_thanks_confirm';
    }
    return 'affirmative_confirm';
  }

  // Qualified reply detector — runs ONLY when no exact token match. "certo,
  // mas troca a coca" or "não, prefiro de manhã" should NOT auto-confirm or
  // auto-cancel even though they contain a positive/negative token.
  if (hasContradictionMarker(text)) {
    return 'unknown';
  }

  // Multi-token phrase: try to match each significant chunk.
  // Examples that should resolve:
  //   "boa noite e ate amanha"          → farewell
  //   "ok obrigado boa noite"           → farewell stack
  //   "perfeito gratidao"               → affirmative
  //   "ok obrigado, ate amanha entao"   → farewell
  const tokens = normalized.split(/[\s,;.!?]+/).filter(Boolean);
  if (tokens.length > 1) {
    let positive = 0;
    let negative = 0;
    let farewell = 0;
    // Try multi-word slices (length 3, 2, 1) so "boa noite e ate amanha" hits.
    const matched = new Set<number>();
    for (let len = Math.min(4, tokens.length); len >= 1; len--) {
      for (let i = 0; i + len <= tokens.length; i++) {
        if (Array.from({ length: len }, (_, k) => i + k).some((idx) => matched.has(idx))) continue;
        const candidate = tokens.slice(i, i + len).join(' ');
        if (AFFIRMATIVE_TOKENS.has(candidate)) {
          positive++;
          if (isFarewellOrThanks(candidate)) farewell++;
          for (let k = 0; k < len; k++) matched.add(i + k);
        } else if (NEGATIVE_TOKENS.has(candidate)) {
          negative++;
          for (let k = 0; k < len; k++) matched.add(i + k);
        }
      }
    }
    if (!hasOnlyConfirmationFillers(tokens, matched)) {
      return 'unknown';
    }
    if (positive > 0 && negative === 0) {
      if (context.lastAiQuestion === 'observation_or_change' && farewell === positive) {
        return 'farewell_or_thanks_confirm';
      }
      return 'affirmative_confirm';
    }
    if (negative > 0 && positive === 0) {
      if (context.lastAiQuestion === 'observation_or_change') {
        return 'farewell_or_thanks_confirm';
      }
      return 'negative_cancel';
    }
  }

  return 'unknown';
}

export type PendingOrderTurnDecision =
  | { action: 'confirm_pending_order'; reason: string; intent: ConfirmationIntent }
  | { action: 'cancel_pending_order'; reason: string; intent: ConfirmationIntent }
  | { action: 'edit_pending_order'; reason: string; editText: string }
  | { action: 'clarify_pending_order'; reason: string }
  | { action: 'escalate_human'; reason: string };

export function classifyPendingOrderTurn(
  raw: string,
  context: ClassifyContext = { lastAiQuestion: 'pending_button_confirm' },
): PendingOrderTurnDecision {
  const text = (raw ?? '').trim();
  const intent = classifyConfirmationIntent(text, context);
  if (intent === 'escalation_request') {
    return { action: 'escalate_human', reason: 'customer requested human/escalation' };
  }
  if (
    intent === 'affirmative_confirm' ||
    intent === 'farewell_or_thanks_confirm' ||
    intent === 'emoji_only_confirm'
  ) {
    return { action: 'confirm_pending_order', reason: 'unambiguous confirmation', intent };
  }
  if (intent === 'negative_cancel') {
    return { action: 'cancel_pending_order', reason: 'unambiguous cancellation', intent };
  }
  if (looksLikePendingEditRequest(text)) {
    return { action: 'edit_pending_order', reason: 'customer provided an edit/change request', editText: text };
  }
  return { action: 'clarify_pending_order', reason: 'ambiguous pending-order reply' };
}

const FAREWELL_TOKENS = new Set<string>([
  'obrigado', 'obrigada', 'obg', 'obgd', 'obrigadao', 'obrigadinho',
  'valeu', 'vlw', 'vlww', 'gratidao', 'grato', 'grata', 'agradecido', 'agradecida',
  'falou', 'flw', 'flww',
  'boa noite', 'bom dia', 'boa tarde',
  'ate amanha', 'ate mais', 'ate logo', 'ate breve', 'ate ja',
  'boa noite ate amanha', 'boa noite e ate amanha', 'ate amanha entao',
]);

function isFarewellOrThanks(token: string): boolean {
  return FAREWELL_TOKENS.has(token);
}

// ---------------------------------------------------------------------------
// Payment-proof message detection
// ---------------------------------------------------------------------------

export interface PaymentProofSignal {
  attachmentKind: 'image' | 'document' | 'audio' | 'video' | 'none';
  caption?: string | null;
}

/**
 * Returns true when a customer message is likely a payment-proof drop:
 * an image or PDF attachment, optionally with a "comprovante" / "pix" caption.
 * Used by the reactivation guardrail to avoid restarting the order flow.
 */
export function isLikelyPaymentProofMessage(signal: PaymentProofSignal): boolean {
  if (signal.attachmentKind === 'image' || signal.attachmentKind === 'document') {
    return true;
  }
  // Caption-only "segue o comprovante" without an attachment doesn't count —
  // we need the actual file. The caller can still decide to ack via text.
  return false;
}

/**
 * Returns true when text alone strongly references payment proof.
 * Useful when an attachment was lost or the customer said "mandei o pix".
 *
 * SAFETY — the bare token `pix` is intentionally NOT a trigger. Customers
 * routinely ask "qual o pix?" or "tem pix?" — those must NOT fire the
 * receipt-acknowledge guard, otherwise the customer would receive a
 * phantom "Recebi seu comprovante" reply. We require either an explicit
 * proof noun (comprovante, recibo) or a verb that locks the meaning to
 * "I sent/paid" (mandei/enviei/paguei/segue).
 */
export function textMentionsPaymentProof(value: string): boolean {
  const norm = normalizeLoose(value);
  if (!norm) return false;
  // Question marks ("qual o pix?") are stripped by normalizeLoose, so we need
  // to check the original text first — a "?" anywhere is a strong signal the
  // customer is ASKING about pix, not announcing a payment.
  if (/[?¿]/u.test(value)) return false;
  if (/\b(comprovante|comprov\w*|recibo)\b/u.test(norm)) return true;
  if (/\b(mandei|enviei|segue|encaminhei)\b.*\bpix\b/u.test(norm)) return true;
  if (/\bpix\b.*\b(mandei|enviei|encaminhei|segue)\b/u.test(norm)) return true;
  if (/\b(paguei|paguei pelo pix|paguei via pix|pago via pix|pago pelo pix)\b/u.test(norm)) return true;
  if (/\bpix\s+(enviado|feito|pago|realizado|efetuado)\b/u.test(norm)) return true;
  if (/\b(transferi|transferencia bancaria|transferencia feita)\b/u.test(norm)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Semantic product matching (Brazilian salgados / informal ordering)
// ---------------------------------------------------------------------------

/**
 * Maps an informal customer phrase to a semantic intent — categories,
 * fryed/baked mode, units (cento / meio cento), and flavor hints.
 * Result is used as a HINT only; final product selection is left to the
 * AI and/or operator clarification.
 */
export function mapInformalSalgadoTerm(raw: string): SemanticIntent {
  const norm = normalizeLoose(raw);
  const intent: SemanticIntent = {
    categories: [],
    mode: null,
    units: null,
    flavorHints: [],
  };
  if (!norm) return intent;

  // mode (fritos / assados / sortidos)
  if (/\b(frito|fritos|fritinho|fritinhos|fritura|frituras|mini frito|mini fritos|fritos do dia)\b/u.test(norm)) {
    intent.mode = 'fritos';
  } else if (/\b(assado|assados|assadinho|assadinhos|forno|de forno|mini assado|mini assados)\b/u.test(norm)) {
    intent.mode = 'assados';
  } else if (/\b(sortido|sortidos|misturad\w*|variad\w*|o que tiver|pode misturar|do jeito que tiver|do dia)\b/u.test(norm)) {
    intent.mode = 'sortidos';
  }

  // categories
  const mentionsSalgado = /\b(salgad\w*|coxinha\w*|risole\w*|kibe\w*|enroladinh\w*|bolinh\w*|empad\w*|esfih\w*|esfirr\w*|hamburg\w*)\b/u.test(norm);
  const isUsuallyBakedMini = /\b(esfih\w*|esfirr\w*|hamburg\w*)\b/u.test(norm);
  if (mentionsSalgado) {
    if (intent.mode === 'assados' || (intent.mode === null && isUsuallyBakedMini)) intent.categories.push('salgado_assado_mini');
    else if (intent.mode === 'sortidos') intent.categories.push('salgado_sortido_mini');
    else intent.categories.push('salgado_frito_mini');
  }
  if (/\b(brigadeiro\w*|beijinho\w*|cajuzinho|doce\w*|trufa\w*)\b/u.test(norm)) {
    intent.categories.push('doce_mini');
  }
  if (/\b(bolo|bolinho de\s+\w+|torta\w*|cuca\w*)\b/u.test(norm)) {
    intent.categories.push('bolo');
  }
  if (/\b(refri|refrigerante|coca|guarana|suco|agua|cha|cerveja)\b/u.test(norm)) {
    intent.categories.push('bebida');
  }

  // flavor hints
  const flavors = [
    { re: /\b(bolinha\s+de\s+queijo|bolinha)\b/u, label: 'bolinha de queijo' },
    { re: /\b(coxinha\s+de\s+frango|coxinha\b)/u, label: 'coxinha de frango' },
    { re: /\bfrang\w+\b/u, label: 'frango' },
    { re: /\b(carne|carne\s+seca|charque)\b/u, label: 'carne' },
    { re: /\b(calabres\w*|salame\w*)\b/u, label: 'calabresa' },
    { re: /\b(presunto\s+e\s+queijo|presunto\b)/u, label: 'presunto' },
    { re: /\bqueijo\b/u, label: 'queijo' },
    { re: /\bcatupiry\b/u, label: 'catupiry' },
    { re: /\b(esfiha|esfirra)\b/u, label: 'esfiha' },
    { re: /\b(hamburguer|hamburguerzinho|hamburg\w*)\b/u, label: 'hamburguer' },
    { re: /\b(quatro\s+queijos|4\s+queijos)\b/u, label: 'quatro queijos' },
    { re: /\bbacalhau\b/u, label: 'bacalhau' },
    { re: /\b(pizza|pizz\w+)\b/u, label: 'pizza' },
    { re: /\bcamar\w+\b/u, label: 'camarão' },
  ];
  for (const f of flavors) {
    if (f.re.test(norm) && !intent.flavorHints.includes(f.label)) {
      intent.flavorHints.push(f.label);
    }
  }

  // units — re-implemented here so the function is self-contained for tests
  intent.units = detectUnitCount(norm);

  return intent;
}

/**
 * Returns the unit count expressed by a phrase, or null if none.
 * Examples (already lowercased + accent-stripped):
 *   "meio cento"          → 50
 *   "um cento"            → 100
 *   "2 centos"            → 200
 *   "dois centos"         → 200
 *   "um quarto de cento"  → 25
 *   "50 mini"             → 50
 *   "30 salgadinhos"      → 30
 *   "centena"             → 100
 */
export function detectUnitCount(normalizedLower: string): number | null {
  if (!normalizedLower) return null;

  if (/\b(um quarto de (um )?cento|1 4 de (um )?cento|quarto de cento|um quarto)\b/.test(normalizedLower)) {
    return 25;
  }
  if (/\b(meio cento|meia centena|metade de um cento|metade do cento|1 2 cento)\b/.test(normalizedLower)) {
    return 50;
  }

  const PT_NUMBERS: Record<string, number> = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  };

  const numeric = normalizedLower.match(/\b(\d{1,4})\s*(cento|centos|centena|centenas)\b/);
  if (numeric) {
    return Math.max(1, Number(numeric[1])) * 100;
  }

  const word = normalizedLower.match(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(cento|centos|centena|centenas)\b/);
  if (word) {
    return (PT_NUMBERS[word[1]] ?? 1) * 100;
  }

  if (/\b(cento|centena)\b/.test(normalizedLower)) return 100;

  // Numeric followed by a "mini / salgad* / unidades" — only when the user
  // wrote a small number explicitly. Avoid matching plain digits (could be a phone).
  const numericWithUnit = normalizedLower.match(/\b(\d{1,4})\s*(mini\w*|salgadinh\w*|salgadin\w*|unidad\w*|unid\w*|uns?|pe[cç]as?)\b/);
  if (numericWithUnit) {
    const n = Number(numericWithUnit[1]);
    if (n >= 1 && n <= 9999) return n;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Catalog helpers reused by resolveProductBySemantic
// ---------------------------------------------------------------------------

export interface CatalogProductLike {
  name: string;
  /** Optional flag — when true, price is per-unit (e.g. mini salgados). */
  unitBased?: boolean;
}

function catalogTokens(value: string): string[] {
  return normalizeLoose(value).split(' ').filter(Boolean);
}

const CATEGORY_KEYWORDS: Record<SemanticCategory, RegExp[]> = {
  salgado_frito_mini: [
    /\bcento\b/u,
    /\b(coxinha|bolinha|risole|kibe|enroladinho|empada|salgad\w*)\b/u,
    /\b(frito|fritos|tradicion\w+)\b/u,
  ],
  salgado_assado_mini: [
    /\bcento\b/u,
    /\b(assado\w*|forno|esfiha|esfirra|hamburg\w*)\b/u,
  ],
  salgado_sortido_mini: [
    /\bcento\b/u,
    /\b(sortid\w+|misturad\w*|variad\w*|tradicion\w+)\b/u,
  ],
  doce_mini: [/\b(doce\w*|brigadeir\w+|beijinh\w+|trufa\w*)\b/u],
  bolo: [/\b(bolo|torta\w*|cuca\w*)\b/u],
  bebida: [/\b(refri|refrigerante|coca|guarana|suco|agua|cha|cerveja)\b/u],
};

function productMatchesCategory(productName: string, category: SemanticCategory): boolean {
  const norm = normalizeLoose(productName);
  // For salgado_frito_mini we accept any catalog entry that mentions cento +
  // is not explicitly assados (assados-only products will fail the negative
  // check). The customer asked for "fritos" but the lanchonete may sell them
  // under names like "Cento Tradicionais Sortidos" without a "frito" token
  // — the business rule is "fritos = non-assados".
  if (category === 'salgado_frito_mini') {
    if (!/\bcento\b/u.test(norm)) return false;
    return !/\b(assad\w*|forno)\b/u.test(norm);
  }
  if (category === 'salgado_assado_mini') {
    if (!/\bcento\b/u.test(norm)) return false;
    return /\b(assad\w*|forno|esfih\w*|esfirr\w*|hamburg\w*)\b/u.test(norm);
  }
  if (category === 'salgado_sortido_mini') {
    if (!/\bcento\b/u.test(norm)) return false;
    return /\b(sortid\w+|misturad\w*|variad\w*|tradicion\w+)\b/u.test(norm);
  }
  return CATEGORY_KEYWORDS[category].every((re) => re.test(norm));
}

function flavorMatchesProduct(flavor: string, productName: string): boolean {
  const flavorTokens = new Set(catalogTokens(flavor).flatMap(expandFlavorTokenAliases));
  if (flavorTokens.size === 0) return false;
  const productTokensSet = new Set(catalogTokens(productName).flatMap(expandFlavorTokenAliases));
  // every significant flavor token must be in the product name
  return [...flavorTokens].every((t) => productTokensSet.has(t));
}

function expandFlavorTokenAliases(token: string): string[] {
  if (token === 'esfiha' || token === 'esfirra') return ['esfiha', 'esfirra'];
  if (token === 'hamburguer' || token === 'hamburguinho') return ['hamburguer', 'hamburguinho'];
  return [token];
}

export type SemanticResolution =
  | { kind: 'unique_match'; product: CatalogProductLike; reason: string }
  | { kind: 'multiple_candidates'; candidates: CatalogProductLike[]; reason: string }
  | { kind: 'no_match'; reason: string };

/**
 * Maps an informal phrase like "salgados fritos" or "meio cento de fritos
 * variados, bolinha e frango" to either a single catalog product, a list of
 * candidates the operator/AI should choose from, or no match.
 *
 * Caller should:
 *   • unique_match → use product directly
 *   • multiple_candidates → ask the customer to pick (or escalate WITH the
 *     candidates list shown to the operator)
 *   • no_match → fall back to existing escalation, but log/show the parsed
 *     intent so the operator sees "salgados fritos = mini fritos, mas
 *     nenhum produto cadastrado encaixou".
 */
export function resolveProductBySemantic(
  inputName: string,
  available: CatalogProductLike[],
): SemanticResolution {
  const intent = mapInformalSalgadoTerm(inputName);
  if (available.length === 0) {
    return { kind: 'no_match', reason: 'cardápio vazio' };
  }
  if (intent.categories.length === 0 && intent.flavorHints.length === 0 && intent.mode === null) {
    return { kind: 'no_match', reason: 'sem categoria/sabor reconhecido na frase do cliente' };
  }

  // 1. flavor-precise match (e.g. "bolinha de queijo" → "Cento de Bolinha de queijo")
  if (intent.flavorHints.length === 1) {
    const flavorMatches = available.filter((p) => flavorMatchesProduct(intent.flavorHints[0], p.name));
    if (flavorMatches.length === 1) {
      return {
        kind: 'unique_match',
        product: flavorMatches[0],
        reason: `sabor "${intent.flavorHints[0]}" mapeou para "${flavorMatches[0].name}"`,
      };
    }
  }

  // 2. category-based candidate set
  let candidates: CatalogProductLike[] = [];
  for (const cat of intent.categories) {
    for (const product of available) {
      if (productMatchesCategory(product.name, cat) && !candidates.includes(product)) {
        candidates.push(product);
      }
    }
  }

  // If only mode is set ("fritos") with no category tokens, treat it as fritos mini.
  if (candidates.length === 0 && intent.mode === 'fritos') {
    candidates = available.filter((p) => productMatchesCategory(p.name, 'salgado_frito_mini'));
  }
  if (candidates.length === 0 && intent.mode === 'assados') {
    candidates = available.filter((p) => productMatchesCategory(p.name, 'salgado_assado_mini'));
  }
  if (candidates.length === 0 && intent.mode === 'sortidos') {
    candidates = available.filter((p) => productMatchesCategory(p.name, 'salgado_sortido_mini'));
  }

  // 3. flavor cross-filter — if the customer mentioned flavors, prefer products
  // that include those flavors in their name. This narrows "bolinha de queijo"
  // out of the candidate list when "Cento de Bolinha de queijo" is present.
  if (intent.flavorHints.length > 0 && candidates.length > 1) {
    const flavorMatches = candidates.filter((p) =>
      intent.flavorHints.some((f) => flavorMatchesProduct(f, p.name)),
    );
    if (flavorMatches.length > 0 && flavorMatches.length < candidates.length) {
      candidates = flavorMatches;
    }
  }

  if (candidates.length === 1) {
    return {
      kind: 'unique_match',
      product: candidates[0],
      reason: `mapeamento semântico "${describeIntent(intent)}" → "${candidates[0].name}"`,
    };
  }
  if (candidates.length > 1) {
    return {
      kind: 'multiple_candidates',
      candidates,
      reason: `mapeamento semântico "${describeIntent(intent)}" gerou ${candidates.length} candidatos`,
    };
  }

  return {
    kind: 'no_match',
    reason: `nenhum produto compatível com "${describeIntent(intent)}"`,
  };
}

function describeIntent(intent: SemanticIntent): string {
  const parts: string[] = [];
  if (intent.units !== null) parts.push(`${intent.units} un`);
  if (intent.mode) parts.push(intent.mode);
  if (intent.categories.length > 0) parts.push(intent.categories.join('+'));
  if (intent.flavorHints.length > 0) parts.push(`sabores: ${intent.flavorHints.join(',')}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// "Active order" state helpers (DB-agnostic; caller supplies rows)
// ---------------------------------------------------------------------------

export type ActiveOrderStatus = 'pending' | 'pending_payment' | 'pending_review' | 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered';

export interface ActiveOrderRow {
  id: string;
  revision?: number;
  status: ActiveOrderStatus;
  total: number;
  paymentMethod: string | null;
  createdAt: string;
}

/**
 * Picks the order this customer is "on" right now.
 * Priority:
 *   1. Most recent non-delivered order created in the last 48h.
 *   2. null otherwise.
 *
 * 48h is a generous window for "pedido feito ontem à noite, mensagem chega
 * hoje cedo". Beyond that, the customer is probably starting a new order and
 * the conversation can proceed normally. Caller decides what to do with it.
 */
export function pickActiveOrder(
  rows: ActiveOrderRow[],
  now = new Date(),
): ActiveOrderRow | null {
  if (rows.length === 0) return null;
  const cutoff = now.getTime() - 48 * 60 * 60 * 1000;
  const candidates = rows
    .filter((r) => r.status !== 'delivered')
    .filter((r) => {
      const t = new Date(r.createdAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// "Did the AI already ask for confirmation/observation?" helpers
// ---------------------------------------------------------------------------

// NOTE: patterns are matched against `normalizeLoose(value)` which strips all
// punctuation including '?'. Patterns must NOT include '?' or other symbols.
const OBSERVATION_QUESTION_PATTERNS: RegExp[] = [
  /gostaria de alterar algo/iu,
  /alguma observac\w+ a fazer/iu,
  /tem alguma observac\w+/iu,
  /alguma alterac\w+\b/iu,
  /algo a mais\b/iu,
  /alguma coisa a mudar/iu,
  /quer alterar algo/iu,
  /quer (mudar|trocar|tirar|adicionar) algo/iu,
];

export function looksLikeObservationPrompt(value: string): boolean {
  if (!value) return false;
  const norm = normalizeLoose(value);
  return OBSERVATION_QUESTION_PATTERNS.some((re) => re.test(norm));
}

/**
 * True when, looking at the recent assistant→user thread, the LAST AI question
 * was the observation prompt and every subsequent customer message was an
 * affirmative / farewell / emoji-only positive. The caller treats this as
 * "the customer answered no-changes" and finalizes the order without
 * re-asking.
 */
export function shouldFinalizeAfterObservationAck(
  messages: { role: string; content: string | null | undefined }[],
): boolean {
  if (!Array.isArray(messages) || messages.length < 2) return false;
  const recent = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-10);

  let promptIdx = -1;
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    if (m.role !== 'assistant') continue;
    if (looksLikeObservationPrompt(m.content ?? '')) {
      promptIdx = i;
      break;
    }
  }
  if (promptIdx === -1) return false;

  const after = recent.slice(promptIdx + 1);
  if (after.length === 0) return false;
  if (after.some((m) => m.role !== 'user')) return false;

  for (const m of after) {
    const intent = classifyConfirmationIntent(m.content ?? '', {
      lastAiQuestion: 'observation_or_change',
    });
    if (
      intent !== 'affirmative_confirm' &&
      intent !== 'farewell_or_thanks_confirm' &&
      intent !== 'emoji_only_confirm'
    ) {
      return false;
    }
  }
  return true;
}
