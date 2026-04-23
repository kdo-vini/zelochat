import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Produto } from '../services/zeloApi';
import { getProdutos, normalizePreco } from '../services/zeloApi';

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
      // Observação: quando o navegador bloqueia por CORS/rede, o fetch geralmente lança TypeError("Failed to fetch")
      const msg = String(e?.message ?? e);
      if (e?.name === 'TypeError' && /Failed to fetch/i.test(msg)) {
        setError(
          'Falha de rede/CORS: o navegador bloqueou a requisição para https://zelopdv.com.br. ' +
            'Confirme se o Origin atual (ex: http://localhost:3000 ou https://chat.zelopdv.com.br) está permitido e se a API está online.'
        );
        setData([]);
        return;
      }
      if (msg.includes('HTTP 401')) setError('401: Token inválido ou sessão expirada. Faça login novamente.');
      else if (msg.includes('HTTP 403')) setError('403: Origem não permitida (CORS) para este ambiente.');
      else if (msg.includes('HTTP 500')) setError('500: Erro interno no servidor ao buscar produtos.');
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

