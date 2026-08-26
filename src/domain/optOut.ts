/** Frases determinísticas de bloqueio usadas tanto pelo recebimento quanto por campanhas. */
export const OPT_OUT_PHRASES = ['PARAR', 'SAIR', 'CANCELAR', 'NAO QUERO MAIS MENSAGENS', 'PARE DE ENVIAR', 'REMOVER MEU NUMERO'] as const;
export function normalizeOptOutText(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
export function isOptOutMessage(value: string): boolean { return OPT_OUT_PHRASES.includes(normalizeOptOutText(value) as typeof OPT_OUT_PHRASES[number]); }
