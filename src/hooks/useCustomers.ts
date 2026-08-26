import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchCustomers,
  serializeCustomerFilters,
  type CustomerFilters,
  type CustomerPage,
  type CustomerSummary,
} from '../services/customerApi';

const EMPTY_PAGE: CustomerPage = { customers: [], nextCursor: null, hasMore: false, total: null };

export interface UseCustomersResult {
  customers: CustomerSummary[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  total: number | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useCustomers(token: string | null, filters: CustomerFilters): UseCustomersResult {
  const filterKey = useMemo(() => serializeCustomerFilters(filters), [filters]);
  const [page, setPage] = useState<CustomerPage>(EMPTY_PAGE);
  const [loading, setLoading] = useState(Boolean(token));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!token) {
      setPage(EMPTY_PAGE);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchCustomers(token, { ...filters, cursor: null });
      if (requestId === requestIdRef.current) setPage(next);
    } catch (cause) {
      if (requestId === requestIdRef.current) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os clientes.');
        setPage(EMPTY_PAGE);
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [filterKey, filters, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!token || loading || loadingMore || !page.hasMore || !page.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await fetchCustomers(token, { ...filters, cursor: page.nextCursor });
      setPage((previous) => ({
        ...next,
        customers: [...previous.customers, ...next.customers.filter((candidate) => !previous.customers.some((item) => item.id === candidate.id))],
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar mais clientes.');
    } finally {
      setLoadingMore(false);
    }
  }, [filters, loading, loadingMore, page.hasMore, page.nextCursor, token]);

  return { customers: page.customers, loading, loadingMore, error, hasMore: page.hasMore, total: page.total, refresh, loadMore };
}
