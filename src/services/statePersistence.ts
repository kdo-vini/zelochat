import { INITIAL_STATE } from '../constants';
import type { ZeloState } from '../types';

const STORAGE_KEY = 'zelochat_state_v2';

// blockedDates and managerHistory are now persisted in Supabase (migration 006).
// They are intentionally excluded here to avoid stale localStorage data overriding DB values.
type PersistedState = Pick<ZeloState, 'businessInfo' | 'profile'>;

function getPersistedSlice(state: ZeloState): PersistedState {
  return {
    businessInfo: state.businessInfo,
    profile: state.profile,
  };
}

export function loadInitialState(): ZeloState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return INITIAL_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedState>;

    return {
      ...INITIAL_STATE,
      businessInfo: {
        ...INITIAL_STATE.businessInfo,
        ...parsed.businessInfo,
      },
      profile: {
        ...INITIAL_STATE.profile,
        ...parsed.profile,
      },
    };
  } catch {
    return INITIAL_STATE;
  }
}

export function saveInitialState(state: ZeloState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getPersistedSlice(state)));
}
