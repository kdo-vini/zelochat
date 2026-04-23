import { Dispatch } from 'react';
import { AppAction } from '../state/rootReducer';
import { getOwnerDailyResponse } from '../agents/owner/agent';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Processes an operational note from the owner and appends extracted directives
 * to the daily context. These directives are immediately visible to the client agent
 * on the next customer interaction (Rule #5).
 */
export async function processDailyNote(
  input: string,
  dispatch: Dispatch<AppAction>
): Promise<void> {
  if (!input.trim()) return;

  const directives = await getOwnerDailyResponse(input);
  const newItems = directives.map(text => ({ id: makeId(), text }));

  dispatch({ type: 'config/addDailyContext', payload: newItems });
}

export function clearDailyContext(dispatch: Dispatch<AppAction>): void {
  dispatch({ type: 'config/clearDailyContext' });
}

export function removeDailyContextItem(id: string, dispatch: Dispatch<AppAction>): void {
  dispatch({ type: 'config/removeDailyContextItem', payload: { id } });
}
