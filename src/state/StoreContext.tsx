import React, { createContext, useContext, useReducer, Dispatch } from 'react';
import { ZeloState } from '../types/state';
import { AppAction, rootReducer } from './rootReducer';
import { INITIAL_STATE } from '../constants/seedData';

interface StoreContextValue {
  state: ZeloState;
  dispatch: Dispatch<AppAction>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(rootReducer, INITIAL_STATE);
  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

// Convenience hooks per domain
export function useCatalog() {
  const { state, dispatch } = useStore();
  return { products: state.products, quickResponses: state.quickResponses, dispatch };
}

export function useCalendar() {
  const { state, dispatch } = useStore();
  return { blockedDates: state.blockedDates, businessInfo: state.businessInfo, dispatch };
}

export function useOrders() {
  const { state, dispatch } = useStore();
  return { orders: state.orders, drivers: state.drivers, dispatch };
}

export function useChat() {
  const { state, dispatch } = useStore();
  return { sessions: state.sessions, dispatch };
}

export function useConfig() {
  const { state, dispatch } = useStore();
  return {
    aiInstructions: state.aiInstructions,
    dailyContext: state.dailyContext,
    alertTriggers: state.alertTriggers,
    managerHistory: state.managerHistory,
    dispatch,
  };
}

export function useProfile() {
  const { state, dispatch } = useStore();
  return { profile: state.profile, dispatch };
}
