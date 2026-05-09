import { useCallback, useEffect, useState } from 'react';
import type { DeliveryDriver } from '../types';
import {
  createDriver as createDriverRequest,
  deleteDriver as deleteDriverRequest,
  getDrivers,
  updateDriver as updateDriverRequest,
} from '../services/driversApi';

function sortDrivers(drivers: DeliveryDriver[]): DeliveryDriver[] {
  return [...drivers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function useDrivers(token: string | null, options: { enabled?: boolean } = {}) {
  const [drivers, setDrivers] = useState<DeliveryDriver[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = options.enabled ?? true;

  const refresh = useCallback(async () => {
    if (!token) {
      setDrivers([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextDrivers = await getDrivers(token);
      setDrivers(sortDrivers(nextDrivers));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os entregadores.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const createDriver = useCallback(async (payload: Pick<DeliveryDriver, 'name' | 'phone' | 'status'>) => {
    if (!token) {
      throw new Error('Faça login para cadastrar entregadores.');
    }

    setError(null);
    try {
      const driver = await createDriverRequest(token, payload);
      setDrivers((previous) => sortDrivers([...previous, driver]));
      return driver;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível cadastrar o entregador.';
      setError(message);
      throw new Error(message);
    }
  }, [token]);

  const updateDriver = useCallback(async (
    id: string,
    payload: Partial<Pick<DeliveryDriver, 'name' | 'phone' | 'status'>>,
  ) => {
    if (!token) {
      throw new Error('Faça login para atualizar entregadores.');
    }

    setError(null);
    try {
      const driver = await updateDriverRequest(token, id, payload);
      setDrivers((previous) =>
        sortDrivers(previous.map((item) => (item.id === id ? driver : item))),
      );
      return driver;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível atualizar o entregador.';
      setError(message);
      throw new Error(message);
    }
  }, [token]);

  const deleteDriver = useCallback(async (id: string) => {
    if (!token) {
      throw new Error('Faça login para remover entregadores.');
    }

    setError(null);
    try {
      await deleteDriverRequest(token, id);
      setDrivers((previous) => previous.filter((item) => item.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível remover o entregador.';
      setError(message);
      throw new Error(message);
    }
  }, [token]);

  return {
    drivers,
    loading,
    error,
    refresh,
    createDriver,
    updateDriver,
    deleteDriver,
  };
}
