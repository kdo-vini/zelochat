import { Dispatch } from 'react';
import { AppAction } from '../state/rootReducer';
import { ChatMessage } from '../types/chat';
import { getManagerResponse } from '../agents/manager/agent';
import {
  ManagerActionItem,
  BlockDatePayload,
  SetAvailabilityPayload,
} from '../agents/manager/types';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Sends a message to the general manager agent and applies any resulting actions
 * (block dates, toggle product availability) to the state.
 */
export async function sendManagerMessage(
  userInput: string,
  history: ChatMessage[],
  productsByName: Record<string, string>, // name → id, for SET_PRODUCT_AVAILABILITY
  dispatch: Dispatch<AppAction>
): Promise<void> {
  if (!userInput.trim()) return;

  // 1. Append user message to manager history
  const userMsg: ChatMessage = {
    id: makeId(),
    role: 'user',
    content: userInput,
    timestamp: nowIso(),
  };
  dispatch({ type: 'config/addManagerMessage', payload: userMsg });

  // 2. Call manager agent
  const result = await getManagerResponse([...history, userMsg], userInput);

  // 3. Append assistant reply
  const botMsg: ChatMessage = {
    id: makeId(),
    role: 'assistant',
    content: result.reply,
    timestamp: nowIso(),
  };
  dispatch({ type: 'config/addManagerMessage', payload: botMsg });

  // 4. Dispatch structural actions
  for (const action of result.actions) {
    applyManagerAction(action, productsByName, dispatch);
  }
}

function applyManagerAction(
  action: ManagerActionItem,
  productsByName: Record<string, string>,
  dispatch: Dispatch<AppAction>
): void {
  switch (action.type) {
    case 'BLOCK_DATE': {
      const payload = action.payload as BlockDatePayload;
      dispatch({ type: 'calendar/addBlockedDate', payload });
      break;
    }
    case 'SET_PRODUCT_AVAILABILITY': {
      const payload = action.payload as SetAvailabilityPayload;
      const productId = productsByName[payload.name.toLowerCase()];
      if (!productId) {
        console.warn(`Manager action references unknown product: ${payload.name}`);
        return;
      }
      dispatch({
        type: 'catalog/setProductAvailability',
        payload: { id: productId, available: payload.available },
      });
      break;
    }
  }
}

export function clearManagerHistory(dispatch: Dispatch<AppAction>): void {
  dispatch({ type: 'config/clearManagerHistory' });
}
