import { AlertTrigger } from '../../types/alerts';
import { ChatMessage } from '../../types/chat';

export interface ConfigState {
  aiInstructions: string;
  dailyContext: { id: string; text: string }[];
  alertTriggers: AlertTrigger[];
  managerHistory: ChatMessage[];
}

export type ConfigAction =
  | { type: 'config/setAiInstructions'; payload: string }
  | { type: 'config/addDailyContext'; payload: { id: string; text: string }[] }
  | { type: 'config/clearDailyContext' }
  | { type: 'config/removeDailyContextItem'; payload: { id: string } }
  | { type: 'config/setAlertTriggerActive'; payload: { id: string; active: boolean } }
  | { type: 'config/addManagerMessage'; payload: ChatMessage }
  | { type: 'config/clearManagerHistory' };

export function configReducer(state: ConfigState, action: ConfigAction): ConfigState {
  switch (action.type) {
    case 'config/setAiInstructions':
      return { ...state, aiInstructions: action.payload };
    case 'config/addDailyContext':
      return { ...state, dailyContext: [...state.dailyContext, ...action.payload] };
    case 'config/clearDailyContext':
      return { ...state, dailyContext: [] };
    case 'config/removeDailyContextItem':
      return {
        ...state,
        dailyContext: state.dailyContext.filter(c => c.id !== action.payload.id),
      };
    case 'config/setAlertTriggerActive':
      return {
        ...state,
        alertTriggers: state.alertTriggers.map(t =>
          t.id === action.payload.id ? { ...t, active: action.payload.active } : t
        ),
      };
    case 'config/addManagerMessage':
      return {
        ...state,
        managerHistory: [...state.managerHistory, action.payload],
      };
    case 'config/clearManagerHistory':
      return { ...state, managerHistory: [] };
    default:
      return state;
  }
}
