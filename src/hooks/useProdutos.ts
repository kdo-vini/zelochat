import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Produto } from '../services/zeloApi';
import { getProdutos, normalizePreco } from '../services/zeloApi';
import { WaServerOfflineError } from '../config';

type Params = {
  token: string | null;
  onlyVisible?: boolean;
};

export function useProdutos(params: Params) {
  const [data, setData] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onlyVisible = params.onlyVisible ?? true;

  const refresh = useCallback(async () => {
    if (!params.token) {
      setError('Faça login para buscar os produtos do PDV.');
      setData([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const produtos = await getProdutos({ token: params.token, onlyVisible });
      setData(produtos);
    } catch (e: any) {
      if (e instanceof WaServerOfflineError) {
        setError(e.message);
        setData([]);
        return;
      }
      const msg = String(e?.message ?? e);
      if (msg.includes('HTTP 401')) setError('Sessão expirada. Faça login novamente.');
      else if (msg.includes('HTTP 403')) setError('Este domínio não tem permissão para acessar o servidor (CORS). Contate o suporte.');
      else if (msg.includes('HTTP 500')) setError('Erro interno no servidor ao buscar produtos.');
      else setError(msg);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [params.token, onlyVisible]);

  useEffect(() => {
    // Carrega automaticamente quando token estiver disponível
    if (params.token) refresh();
  }, [params.token, refresh]);

  const normalized = useMemo(() => {
    return data.map(p => ({
      ...p,
      preco: normalizePreco(p.preco),
    }));
  }, [data]);

  return { data: normalized, loading, error, refresh };
}

