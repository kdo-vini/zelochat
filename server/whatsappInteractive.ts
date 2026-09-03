type InteractiveSource = 'button' | 'list' | 'template' | 'native_flow';

export interface NormalizedIncomingInteractive {
  id: string;
  title: string | null;
  source: InteractiveSource;
}

const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 240;
const MAX_NATIVE_JSON_LENGTH = 8_000;
const CONTROL_CHAR_REGEX = /[\u0000-\u001f\u007f]/u;

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || CONTROL_CHAR_REGEX.test(trimmed)) return null;
  return trimmed;
}

function safeParseJson(value: string): Record<string, unknown> | null {
  if (!value || value.length > MAX_NATIVE_JSON_LENGTH) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractNativeFlowPayload(payload: Record<string, unknown>): { id: string | null; title: string | null } {
  const directId = cleanString(payload.id ?? payload.selectedRowId ?? payload.selectedButtonId ?? payload.rowId, MAX_ID_LENGTH);
  const directTitle = cleanString(payload.title, MAX_TITLE_LENGTH)
    ?? cleanString(payload.displayText, MAX_TITLE_LENGTH)
    ?? cleanString(payload.text, MAX_TITLE_LENGTH)
    ?? cleanString(payload.name, MAX_TITLE_LENGTH);

  if (directId) return { id: directId, title: directTitle };

  const responseJson = typeof payload.responseJson === 'string'
    ? safeParseJson(payload.responseJson)
    : null;
  if (responseJson) {
    const nestedId = cleanString(
      responseJson.id
      ?? responseJson.selectedRowId
      ?? responseJson.selectedButtonId
      ?? responseJson.rowId,
      MAX_ID_LENGTH,
    );
    const nestedTitle = cleanString(
      responseJson.title
      ?? responseJson.selectedDisplayText
      ?? responseJson.displayText
      ?? responseJson.text,
      MAX_TITLE_LENGTH,
    );
    if (nestedId) return { id: nestedId, title: nestedTitle };
  }

  return { id: null, title: directTitle };
}

export function normalizeIncomingInteractive(payload: unknown): NormalizedIncomingInteractive | null {
  if (!payload || typeof payload !== 'object') return null;
  const message = payload as Record<string, unknown>;

  const button = message.buttonsResponseMessage as Record<string, unknown> | undefined;
  if (button) {
    const id = cleanString(button.selectedButtonId, MAX_ID_LENGTH);
    const title = cleanString(button.selectedDisplayText, MAX_TITLE_LENGTH);
    if (id) return { id, title, source: 'button' };
  }

  const list = message.listResponseMessage as Record<string, unknown> | undefined;
  if (list) {
    const reply = list.singleSelectReply as Record<string, unknown> | undefined;
    const id = cleanString(reply?.selectedRowId, MAX_ID_LENGTH);
    const title = cleanString(list.title, MAX_TITLE_LENGTH)
      ?? cleanString(reply?.title, MAX_TITLE_LENGTH)
      ?? cleanString(reply?.selectedDisplayText, MAX_TITLE_LENGTH);
    if (id) return { id, title, source: 'list' };
  }

  const template = message.templateButtonReplyMessage as Record<string, unknown> | undefined;
  if (template) {
    const id = cleanString(template.selectedId, MAX_ID_LENGTH);
    const title = cleanString(template.selectedDisplayText, MAX_TITLE_LENGTH);
    if (id) return { id, title, source: 'template' };
  }

  const interactive = message.interactiveResponseMessage as Record<string, unknown> | undefined;
  const nativeFlow = interactive?.nativeFlowResponseMessage as Record<string, unknown> | undefined;
  const body = interactive?.body as Record<string, unknown> | undefined;
  if (nativeFlow) {
    const parsed = typeof nativeFlow.paramsJson === 'string'
      ? safeParseJson(nativeFlow.paramsJson)
      : null;
    const extracted = parsed ? extractNativeFlowPayload(parsed) : { id: null, title: null };
    const title = extracted.title ?? cleanString(body?.text, MAX_TITLE_LENGTH);
    if (extracted.id) return { id: extracted.id, title, source: 'native_flow' };
  }

  return null;
}
