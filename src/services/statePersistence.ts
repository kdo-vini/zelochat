import { INITIAL_STATE } from '../constants';
import type { ZeloState } from '../types';

const STORAGE_KEY = 'zelochat_state_v2';

type PersistedState = Pick<
  ZeloState,
  | 'blockedDates'
  | 'aiInstructions'
  | 'quickResponses'
  | 'dailyContext'
  | 'alertTriggers'
  | 'managerHistory'
  | 'businessInfo'
  | 'profile'
  | 'notificationPrefs'
>;

function getPersistedSlice(state: ZeloState): PersistedState {
  return {
    blockedDates: state.blockedDates,
    aiInstructions: state.aiInstructions,
    quickResponses: state.quickResponses,
    dailyContext: state.dailyContext,
    alertTriggers: state.alertTriggers,
    managerHistory: state.managerHistory,
    businessInfo: state.businessInfo,
    profile: state.profile,
    notificationPrefs: state.notificationPrefs,
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
      ...parsed,
      businessInfo: {
        ...INITIAL_STATE.businessInfo,
        ...parsed.businessInfo,
      },
      profile: {
        ...INITIAL_STATE.profile,
        ...parsed.profile,
      },
      notificationPrefs: {
        ...INITIAL_STATE.notificationPrefs,
        ...parsed.notificationPrefs,
      },
    };
  } catch {
    return INITIAL_STATE;
  }
}

export function saveInitialState(state: ZeloState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getPersistedSlice(state)));
}
