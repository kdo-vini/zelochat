import React, { Suspense, lazy } from 'react';
import type { View } from './Sidebar';
import type { Order, ZeloState } from '../types';
import type { OrderFocusRequest } from '../domain/orderFocus';
import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext } from '@hello-pangea/dnd';
import { PRICING } from '../data/pricing';

const DashboardView = lazy(() =>
  import('./views/DashboardView').then((m) => ({ default: m.DashboardView })),
);
const ProductionView = lazy(() =>
  import('./views/ProductionView').then((m) => ({ default: m.ProductionView })),
);
const CalendarView = lazy(() =>
  import('./views/CalendarView').then((m) => ({ default: m.CalendarView })),
);
const AIConfigsView = lazy(() =>
  import('./views/AIConfigsView').then((m) => ({ default: m.AIConfigsView })),
);
const SettingsView = lazy(() =>
  import('./views/SettingsView').then((m) => ({ default: m.SettingsView })),
);
const ProfileView = lazy(() =>
  import('./views/ProfileView').then((m) => ({ default: m.ProfileView })),
);
const DriversView = lazy(() =>
  import('./views/DriversView').then((m) => ({ default: m.DriversView })),
);
const NovidadesView = lazy(() =>
  import('./views/NovidadesView').then((m) => ({ default: m.NovidadesView })),
);
const CustomersView = lazy(() =>
  import('./views/CustomersView').then((m) => ({ default: m.CustomersView })),
);

interface Props {
  activeView: View;
  token: string | null;
  isGeneralMode: boolean;
  subscriptionLoading: boolean;
  subscriptionActive: boolean;
  setState: React.Dispatch<React.SetStateAction<ZeloState>>;
  setActiveView: (view: View) => void;
  // View-specific state slices (memoized)
  chatView: React.ReactNode;
  dashboardState: { profile: ZeloState['profile'] };
  productionState: { orders: Order[] };
  calendarState: { orders: Order[]; blockedDates: ZeloState['blockedDates']; businessInfo: ZeloState['businessInfo'] };
  aiConfigsState: { aiInstructions: ZeloState['aiInstructions']; blockedDates: ZeloState['blockedDates']; pixReceiptConfig: ZeloState['pixReceiptConfig'] };
  settingsState: { businessInfo: ZeloState['businessInfo']; blockedDates: ZeloState['blockedDates']; deliveryConfig: ZeloState['deliveryConfig']; drivers: ZeloState['drivers']; quickResponses: ZeloState['quickResponses']; triggers: ZeloState['triggers']; aiInstructions: ZeloState['aiInstructions']; pixReceiptConfig: ZeloState['pixReceiptConfig'] };
  profileState: { profile: ZeloState['profile']; aiInstructions: ZeloState['aiInstructions']; blockedDates: ZeloState['blockedDates']; businessInfo: ZeloState['businessInfo']; deliveryConfig: ZeloState['deliveryConfig']; drivers: ZeloState['drivers']; quickResponses: ZeloState['quickResponses']; triggers: ZeloState['triggers'] };
  // Callbacks
  onDragEnd: (result: DropResult) => void;
  handleAddOrder: (payload: Omit<Order, 'id' | 'createdAt'>) => Promise<void>;
  handleEditOrder: (id: string, payload: Omit<Order, 'id' | 'createdAt'>) => Promise<void>;
  handleDeleteOrder: (id: string) => Promise<void>;
  updateOrderStatus: (orderId: string, newStatus: Order['status']) => void;
  reprintOrder: (order: Order) => Promise<void>;
  canPrint: boolean;
  pendingOrderFocus: { request: OrderFocusRequest; key: number } | null;
  handleNavigateToKanban: () => void;
  onOpenAtendimento: (sessionId: string) => void;
  customerPermissions: { pessoasVisualizar: boolean; clientesComunicar: boolean };
  canManageCustomers: boolean;
  // AI configs
  triggers: any[];
  triggersError: any;
  createTrigger: (...args: any[]) => any;
  updateTriggerRequest: (...args: any[]) => any;
  deleteTriggerRequest: (...args: any[]) => any;
  quickResponses: any[];
  addQuickResponse: (...args: any[]) => any;
  updateQuickResponse: (...args: any[]) => any;
  deleteQuickResponse: (...args: any[]) => any;
  saveAiInstructions: (instructions: string) => Promise<boolean>;
  // Settings
  empresa: any;
  saveEmpresa: any;
  zelochatMode: string;
  // Drivers
  drivers: any[];
  driversLoading: boolean;
  driversError: any;
  createDriver: (...args: any[]) => any;
  updateDriver: (...args: any[]) => any;
  deleteDriver: (...args: any[]) => any;
  onDispatchSuccess: (orderId: string) => void;
  // Orders for drivers view
  orders: Order[];
}

export function MainContent({
  activeView, token, isGeneralMode, subscriptionLoading, subscriptionActive,
  setState, setActiveView,
  chatView, dashboardState, productionState, calendarState,
  aiConfigsState, settingsState, profileState,
  onDragEnd, handleAddOrder, handleEditOrder, handleDeleteOrder,
  updateOrderStatus, reprintOrder, canPrint,
  pendingOrderFocus, handleNavigateToKanban,
  onOpenAtendimento,
  customerPermissions,
  canManageCustomers,
  triggers, triggersError, createTrigger, updateTriggerRequest, deleteTriggerRequest,
  quickResponses, addQuickResponse, updateQuickResponse, deleteQuickResponse,
  saveAiInstructions,
  empresa, saveEmpresa, zelochatMode,
  drivers, driversLoading, driversError, createDriver, updateDriver, deleteDriver,
  onDispatchSuccess, orders,
}: Props) {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {token && !subscriptionLoading && !subscriptionActive
        && activeView !== 'settings' && activeView !== 'profile' && activeView !== 'novidades' ? (
        <div className="flex flex-1 items-center justify-center bg-[var(--color-canvas)] px-6">
          <div className="max-w-md w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl shadow-sm p-8 text-center">
            <div className="text-3xl mb-3">🔒</div>
            <h2 className="text-[20px] font-semibold text-[var(--color-ink)] mb-2">
              Ative seu plano para usar o ZeloChat
            </h2>
            <p className="text-[14px] text-[var(--color-ink-muted)] leading-relaxed mb-6">
              {isGeneralMode
                ? `A IA e o WhatsApp ficam disponíveis assim que sua assinatura estiver ativa. R$${PRICING.chat.priceBRL}/mês, cancela quando quiser.`
                : `A IA, o WhatsApp, o kanban e o catálogo ficam disponíveis assim que sua assinatura estiver ativa. R$${PRICING.chat.priceBRL}/mês, cancela quando quiser.`}
            </p>
            <button
              onClick={() => setActiveView('settings')}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-[var(--color-brand)] text-white text-[14px] font-medium hover:bg-[var(--color-brand-deep)] transition-colors"
            >
              Ver planos
            </button>
          </div>
        </div>
      ) : (
        <>
          {activeView === 'chat' && chatView}
          {activeView !== 'chat' && (
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center bg-[var(--color-canvas)]">
                  <div className="w-6 h-6 rounded-full border-2 border-[var(--color-brand)] border-t-transparent animate-spin" />
                </div>
              }
            >
              <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-canvas)]">
                {activeView === 'dashboard' && !isGeneralMode && (
                  <DashboardView state={dashboardState} setActiveView={setActiveView} token={token} />
                )}
                {activeView === 'customers' && (
                  <CustomersView token={token} onOpenAtendimento={onOpenAtendimento} customerPermissions={customerPermissions} canManageCustomers={canManageCustomers} />
                )}
                {activeView === 'kanban' && !isGeneralMode && (
                  <DragDropContext onDragEnd={onDragEnd}>
                    <ProductionView
                      state={productionState}
                      onDragEnd={onDragEnd}
                      setActiveView={setActiveView}
                      onAddOrder={handleAddOrder}
                      onEditOrder={handleEditOrder}
                      onDeleteOrder={handleDeleteOrder}
                      onUpdateStatus={updateOrderStatus}
                      onReprintOrder={reprintOrder}
                      canPrint={canPrint}
                      isAuthenticated={!!token}
                      focusedOrderRequest={pendingOrderFocus?.request ?? null}
                      focusedOrderRequestKey={pendingOrderFocus?.key ?? null}
                    />
                  </DragDropContext>
                )}
                {activeView === 'calendar' && !isGeneralMode && (
                  <CalendarView
                    state={calendarState}
                    setState={setState}
                    onNavigateToKanban={handleNavigateToKanban}
                  />
                )}
                {activeView === 'ai-configs' && (
                  <AIConfigsView
                    state={aiConfigsState}
                    setState={setState}
                    triggers={triggers}
                    triggersError={triggersError}
                    createTrigger={createTrigger}
                    updateTrigger={updateTriggerRequest}
                    deleteTrigger={deleteTriggerRequest}
                    quickResponses={quickResponses}
                    addQuickResponse={addQuickResponse}
                    updateQuickResponse={updateQuickResponse}
                    deleteQuickResponse={deleteQuickResponse}
                    saveAiInstructions={saveAiInstructions}
                    token={token}
                  />
                )}
                {activeView === 'settings' && (
                  <SettingsView
                    state={settingsState}
                    setState={setState}
                    empresa={empresa}
                    saveEmpresa={saveEmpresa}
                    isAuthenticated={!!token}
                    token={token}
                    zelochatMode={zelochatMode}
                  />
                )}
                {activeView === 'profile' && (
                  <ProfileView
                    state={profileState}
                    setState={setState}
                    empresa={empresa}
                    saveEmpresa={saveEmpresa}
                    token={token}
                  />
                )}
                {activeView === 'drivers' && !isGeneralMode && (
                  <DriversView
                    orders={orders}
                    drivers={drivers}
                    isAuthenticated={!!token}
                    loading={driversLoading}
                    error={driversError}
                    createDriver={createDriver}
                    updateDriver={updateDriver}
                    deleteDriver={deleteDriver}
                    token={token}
                    onDispatchSuccess={onDispatchSuccess}
                  />
                )}
                {activeView === 'novidades' && (
                  <NovidadesView />
                )}
              </div>
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}
