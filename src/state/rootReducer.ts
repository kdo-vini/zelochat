import { ZeloState } from '../types/state';
import { catalogReducer, CatalogAction } from './slices/catalogSlice';
import { calendarReducer, CalendarAction } from './slices/calendarSlice';
import { ordersReducer, OrdersAction } from './slices/ordersSlice';
import { chatReducer, ChatAction } from './slices/chatSlice';
import { configReducer, ConfigAction } from './slices/configSlice';
import { profileReducer, ProfileAction } from './slices/profileSlice';

export type AppAction =
  | CatalogAction
  | CalendarAction
  | OrdersAction
  | ChatAction
  | ConfigAction
  | ProfileAction;

export function rootReducer(state: ZeloState, action: AppAction): ZeloState {
  const catalogState = catalogReducer(
    { products: state.products, quickResponses: state.quickResponses },
    action as CatalogAction
  );
  const calendarState = calendarReducer(
    { blockedDates: state.blockedDates, businessInfo: state.businessInfo },
    action as CalendarAction
  );
  const ordersState = ordersReducer(
    { orders: state.orders, drivers: state.drivers },
    action as OrdersAction
  );
  const chatState = chatReducer(
    { sessions: state.sessions, activeSessionId: '' },
    action as ChatAction
  );
  const configState = configReducer(
    { aiInstructions: state.aiInstructions, dailyContext: state.dailyContext, alertTriggers: state.alertTriggers, managerHistory: state.managerHistory },
    action as ConfigAction
  );
  const profileState = profileReducer(state.profile, action as ProfileAction);

  return {
    ...state,
    ...catalogState,
    ...calendarState,
    ...ordersState,
    sessions: chatState.sessions,
    ...configState,
    profile: profileState,
  };
}
