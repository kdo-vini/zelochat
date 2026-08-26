import type { Response } from 'express';

/**
 * Maps access-control codes to customer-facing Portuguese responses. Internal
 * codes remain in the structured `code` field for the frontend, never in copy.
 */
export function sendAuthError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';

  if (message === 'UNAUTHORIZED') {
    res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    return;
  }

  if (message === 'EMPRESA_NOT_FOUND') {
    res.status(403).json({ error: 'Empresa não encontrada para este usuário', code: 'EMPRESA_NOT_FOUND' });
    return;
  }

  if (message === 'FORBIDDEN') {
    res.status(403).json({
      error: 'Você não tem permissão para realizar esta ação.',
      code: 'FORBIDDEN',
    });
    return;
  }

  if (message === 'SUBSCRIPTION_INACTIVE') {
    res.status(402).json({
      error: 'Ative seu plano ZeloChat para conectar o WhatsApp.',
      code: 'SUBSCRIPTION_INACTIVE',
    });
    return;
  }

  res.status(500).json({ error: message });
}
