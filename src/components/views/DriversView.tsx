import React, { useEffect, useState } from 'react';
import { Bike, Check, Loader2, MapPin, MessageCircle, Pencil, Plus, X } from 'lucide-react';
import type { DeliveryDriver, Order } from '../../types';

const FIELD = 'w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] transition-colors';

const STATUS_LABEL: Record<DeliveryDriver['status'], string> = {
  available: 'Disponível',
  busy: 'Em corrida',
  offline: 'Offline',
};

const STATUS_COLOR: Record<DeliveryDriver['status'], string> = {
  available: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]',
  busy: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
  offline: 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]',
};

const DOT_COLOR: Record<DeliveryDriver['status'], string> = {
  available: 'bg-[var(--color-brand)]',
  busy: 'bg-[var(--color-warn)]',
  offline: 'bg-[var(--color-ink-faint)]',
};

type DriverDraft = {
  id: string | null;
  name: string;
  phone: string;
  status: DeliveryDriver['status'];
};

const EMPTY_DRAFT: DriverDraft = {
  id: null,
  name: '',
  phone: '',
  status: 'available',
};

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function stripCountryCode(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits.slice(2) : digits;
}

interface DriversViewProps {
  orders: Order[];
  drivers: DeliveryDriver[];
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  createDriver: (payload: Pick<DeliveryDriver, 'name' | 'phone' | 'status'>) => Promise<DeliveryDriver>;
  updateDriver: (
    id: string,
    payload: Partial<Pick<DeliveryDriver, 'name' | 'phone' | 'status'>>,
  ) => Promise<DeliveryDriver>;
  deleteDriver: (id: string) => Promise<void>;
}

export const DriversView = ({
  orders,
  drivers,
  isAuthenticated,
  loading,
  error,
  createDriver,
  updateDriver,
  deleteDriver,
}: DriversViewProps) => {
  const [draft, setDraft] = useState<DriverDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const pendingDeliveries = orders.filter((order): order is Order => order.status === 'ready');
  const isEditing = !!draft.id;
  const localDigits = draft.phone.replace(/\D/g, '');
  const isFormValid = draft.name.trim().length > 0 && localDigits.length >= 10 && localDigits.length <= 11;

  useEffect(() => {
    if (!draft.id) {
      return;
    }

    const currentDriver = drivers.find((driver) => driver.id === draft.id);
    if (!currentDriver) {
      setDraft(EMPTY_DRAFT);
    }
  }, [draft.id, drivers]);

  const resetForm = () => {
    setDraft(EMPTY_DRAFT);
    setActionError(null);
  };

  const startEditing = (driver: DeliveryDriver) => {
    setDraft({
      id: driver.id,
      name: driver.name,
      phone: stripCountryCode(driver.phone),
      status: driver.status,
    });
    setActionError(null);
  };

  const handleSubmit = async () => {
    if (!isFormValid || submitting) {
      return;
    }

    setSubmitting(true);
    setActionError(null);

    const payload = {
      name: draft.name.trim(),
      phone: normalizePhone(draft.phone),
      status: draft.status,
    };

    try {
      if (draft.id) {
        await updateDriver(draft.id, payload);
      } else {
        await createDriver(payload);
      }
      resetForm();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível salvar o entregador.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveDriver = async (driver: DeliveryDriver) => {
    if (submitting) {
      return;
    }

    const confirmed = window.confirm(`Remover o entregador ${driver.name}?`);
    if (!confirmed) {
      return;
    }

    setSubmitting(true);
    setActionError(null);

    try {
      await deleteDriver(driver.id);
      if (draft.id === driver.id) {
        resetForm();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível remover o entregador.');
    } finally {
      setSubmitting(false);
    }
  };

  const notifyDriver = (driver: DeliveryDriver, order?: Order) => {
    const message = order?.deliveryAddress
      ? `Olá ${driver.name}! Nova entrega!\n\nCliente: ${order.customerName}\nEndereço: ${order.deliveryAddress}\nTotal: R$ ${order.total.toFixed(2)}`
      : `Olá ${driver.name}, temos uma nova corrida para você!`;
    window.open(`https://wa.me/${driver.phone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const cycleStatus = async (driver: DeliveryDriver) => {
    if (!isAuthenticated || submitting) {
      return;
    }

    const sequence: DeliveryDriver['status'][] = ['available', 'busy', 'offline'];
    const next = sequence[(sequence.indexOf(driver.status) + 1) % sequence.length];

    setSubmitting(true);
    setActionError(null);

    try {
      await updateDriver(driver.id, { status: next });
      if (draft.id === driver.id) {
        setDraft((previous) => ({ ...previous, status: next }));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível atualizar o status.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1100px] mx-auto px-8 py-8 space-y-6">
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight">Motoboys</h1>
          <p className="text-[13px] text-[var(--color-ink-muted)]">
            Cadastre, edite e despache entregadores por empresa usando a estrutura multi-tenant do Zelo.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="space-y-4">
            <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-semibold">
                  {isEditing ? 'Editar entregador' : 'Cadastrar entregador'}
                </h3>
                {isEditing && (
                  <button
                    onClick={resetForm}
                    className="text-[12px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="block text-[11.5px] font-medium text-[var(--color-ink-muted)] mb-1">Nome</label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
                    placeholder="Ex: Carlos Silva"
                    className={FIELD}
                    disabled={!isAuthenticated || submitting}
                  />
                </div>

                <div>
                  <label className="block text-[11.5px] font-medium text-[var(--color-ink-muted)] mb-1">
                    WhatsApp
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-mono text-[var(--color-ink-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-2.5 py-2 select-none whitespace-nowrap">
                      +55
                    </span>
                    <input
                      type="text"
                      value={draft.phone}
                      onChange={(event) => setDraft((previous) => ({ ...previous, phone: event.target.value }))}
                      placeholder="11999999999"
                      className={`${FIELD} font-mono flex-1`}
                      disabled={!isAuthenticated || submitting}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11.5px] font-medium text-[var(--color-ink-muted)] mb-1">Status</label>
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        status: event.target.value as DeliveryDriver['status'],
                      }))
                    }
                    className={FIELD}
                    disabled={!isAuthenticated || submitting}
                  >
                    <option value="available">Disponível</option>
                    <option value="busy">Em corrida</option>
                    <option value="offline">Offline</option>
                  </select>
                </div>

                <button
                  onClick={() => void handleSubmit()}
                  disabled={!isAuthenticated || !isFormValid || submitting}
                  className="w-full flex items-center justify-center gap-2 bg-[var(--color-ink)] text-white rounded-lg py-2.5 text-[13.5px] font-semibold hover:bg-[var(--color-ink-soft)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                  ) : isEditing ? (
                    <Check className="w-4 h-4" strokeWidth={2} />
                  ) : (
                    <Plus className="w-4 h-4" strokeWidth={2} />
                  )}
                  {isEditing ? 'Salvar alterações' : 'Adicionar entregador'}
                </button>
              </div>

              {!isAuthenticated && (
                <p className="text-[12px] text-[var(--color-warn)]">
                  Faça login em Perfil para gerenciar os motoboys da sua empresa.
                </p>
              )}

              {(actionError || error) && (
                <div className="bg-[var(--color-alert-soft)] border border-[var(--color-alert)]/20 rounded-lg px-3 py-2.5">
                  <p className="text-[12px] text-[var(--color-alert)] font-medium">{actionError ?? error}</p>
                </div>
              )}
            </div>

            {pendingDeliveries.length > 0 && (
              <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--color-line)] flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
                  <p className="text-[13.5px] font-semibold">
                    Prontos para entrega
                    <span className="ml-2 text-[12px] font-medium text-[var(--color-ink-muted)]">
                      ({pendingDeliveries.length})
                    </span>
                  </p>
                </div>

                <div className="divide-y divide-[var(--color-line)]">
                  {pendingDeliveries.map((order) => (
                    <div key={order.id} className="p-4 space-y-2.5">
                      <p className="text-[13.5px] font-semibold">{order.customerName}</p>
                      <p className="text-[12px] text-[var(--color-ink-muted)] truncate">
                        {order.deliveryAddress || 'Retirada no local'}
                      </p>
                      <select
                        defaultValue=""
                        onChange={(event) => {
                          const driver = drivers.find((item) => item.id === event.target.value);
                          if (driver) {
                            notifyDriver(driver, order);
                          }
                        }}
                        className="w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20"
                        disabled={drivers.length === 0}
                      >
                        <option value="" disabled>
                          Chamar motoboy...
                        </option>
                        {drivers.filter((driver) => driver.status === 'available').map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.name}
                          </option>
                        ))}
                        {drivers.filter((driver) => driver.status !== 'available').length > 0 && (
                          <optgroup label="Outros">
                            {drivers.filter((driver) => driver.status !== 'available').map((driver) => (
                              <option key={driver.id} value={driver.id}>
                                {driver.name} ({STATUS_LABEL[driver.status]})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            {loading && drivers.length === 0 ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex flex-col items-center justify-center py-16 text-center">
                <Loader2 className="w-8 h-8 text-[var(--color-ink-faint)] animate-spin mb-3" strokeWidth={1.8} />
                <p className="text-[14px] font-medium text-[var(--color-ink-muted)]">Carregando entregadores</p>
              </div>
            ) : drivers.length === 0 ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex flex-col items-center justify-center py-16 text-center">
                <Bike className="w-8 h-8 text-[var(--color-ink-faint)] opacity-40 mb-3" strokeWidth={1.5} />
                <p className="text-[14px] font-medium text-[var(--color-ink-muted)]">Nenhum entregador cadastrado</p>
                <p className="text-[13px] text-[var(--color-ink-faint)] mt-1">
                  Cadastre o primeiro motoboy da sua empresa no formulário ao lado.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {drivers.map((driver) => (
                  <div
                    key={driver.id}
                    className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-5 flex flex-col gap-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[var(--color-surface-muted)] rounded-full flex items-center justify-center text-[15px] font-semibold text-[var(--color-ink-soft)] flex-shrink-0 border border-[var(--color-line)]">
                          {driver.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-[14px] font-semibold">{driver.name}</p>
                          <p className="text-[12px] font-mono text-[var(--color-ink-muted)]">+{driver.phone}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEditing(driver)}
                          className="p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)] rounded-md transition-colors"
                          aria-label={`Editar ${driver.name}`}
                          disabled={!isAuthenticated || submitting}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void handleRemoveDriver(driver)}
                          className="p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)] rounded-md transition-colors"
                          aria-label={`Remover ${driver.name}`}
                          disabled={!isAuthenticated || submitting}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`flex-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold ${STATUS_COLOR[driver.status]}`}>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT_COLOR[driver.status]}`} />
                        {STATUS_LABEL[driver.status]}
                      </span>
                      <button
                        onClick={() => void cycleStatus(driver)}
                        className="px-2.5 py-1.5 text-[12px] font-medium bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] rounded-lg hover:bg-[var(--color-line)] transition-colors disabled:opacity-40"
                        disabled={!isAuthenticated || submitting}
                      >
                        Mudar status
                      </button>
                    </div>

                    <button
                      onClick={() => notifyDriver(driver)}
                      className="w-full flex items-center justify-center gap-2 bg-[#25d366] hover:bg-[#20bd5a] text-white py-2 rounded-lg text-[13px] font-semibold transition-colors"
                    >
                      <MessageCircle className="w-4 h-4" strokeWidth={1.8} />
                      Avisar no WhatsApp
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
