import { ZeloState } from '../types/state';
import { ChatMessage } from '../types/chat';
import { AppAction } from '../state/rootReducer';
import { Dispatch } from 'react';
import { buildClientContext } from '../agents/client/context';
import { getClientResponse } from '../agents/client/agent';
import { parseAlertTags } from '../domain/alerts/parser';

function nowTimestamp(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function makeMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Handles a customer sending a message: dispatches user message, calls the client agent,
 * parses alerts, and dispatches the assistant response.
 */
export async function replyAsClient(
  sessionId: string,
  userText: string,
  state: ZeloState,
  dispatch: Dispatch<AppAction>,
  now: Date = new Date()
): Promise<void> {
  // 1. Append user message to session
  const userMsg: ChatMessage = {
    id: makeMessageId(),
    role: 'user',
    content: userText,
    timestamp: nowTimestamp(),
  };
  dispatch({ type: 'chat/addMessage', payload: { sessionId, message: userMsg } });

  // 2. Build client context slice (NOT full state)
  const ctx = buildClientContext(state);

  // 3. Get conversation history for this session
  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return;
  const history = [...session.messages, userMsg];

  // 4. Call client agent — prompt already includes business hours guard + blocked dates guard
  const rawResponse = await getClientResponse(ctx, history, userText, now);

  // 5. Parse out <ALERT> tags — domain-level concern
  const { cleanText, alertIds } = parseAlertTags(rawResponse);

  // 6. Dispatch assistant response
  const assistantMsg: ChatMessage = {
    id: makeMessageId(),
    role: 'assistant',
    content: cleanText,
    timestamp: nowTimestamp(),
  };
  dispatch({ type: 'chat/addMessage', payload: { sessionId, message: assistantMsg } });

  // 7. Dispatch detected alerts to session
  if (alertIds.length > 0) {
    dispatch({ type: 'chat/addAlerts', payload: { sessionId, alertIds } });
  }
}

/**
 * Sends a manual message from the lanchonete operator (not through the AI).
 */
export function sendManualOperatorMessage(
  sessionId: string,
  content: string,
  dispatch: Dispatch<AppAction>
): void {
  const msg: ChatMessage = {
    id: makeMessageId(),
    role: 'assistant',
    content,
    timestamp: nowTimestamp(),
  };
  dispatch({ type: 'chat/addMessage', payload: { sessionId, message: msg } });
}

/**
 * Sends a quick-response macro message from the operator.
 */
export function sendQuickResponse(
  sessionId: string,
  responseText: string,
  dispatch: Dispatch<AppAction>
): void {
  sendManualOperatorMessage(sessionId, responseText, dispatch);
}
