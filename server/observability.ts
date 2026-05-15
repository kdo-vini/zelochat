import type { NextFunction, Request, Response } from 'express';

const DEFAULT_SLOW_REQUEST_MS = 2000;
const parsedSlowRequestMs = Number(process.env.SLOW_REQUEST_MS ?? DEFAULT_SLOW_REQUEST_MS);
const SLOW_REQUEST_MS = Number.isFinite(parsedSlowRequestMs) && parsedSlowRequestMs > 0
  ? parsedSlowRequestMs
  : DEFAULT_SLOW_REQUEST_MS;

export interface EmpresaScopedRequest extends Request {
  empresaId?: string;
}

export function slowRequestLogger(req: EmpresaScopedRequest, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (durationMs < SLOW_REQUEST_MS) return;

    const empresaId = req.empresaId ?? 'unknown';
    console.warn('[slow_request]', {
      empresaId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs),
    });
  });

  next();
}
