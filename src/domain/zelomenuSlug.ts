// ZeloMenu — slug público da loja (ZLM-203 / D-102).
//
// Domínio puro, node-free: usado pelo backend (resolução slug→empresa na rota
// pública) e pelo frontend (validação ao operador escolher seu slug). A coluna
// canônica é PDV-owned (`empresa_perfil.zelomenu_slug`), única quando não-nula.

const SLUG_MIN = 3;
const SLUG_MAX = 40;
const DIACRITICS = /[\u0300-\u036f]/g;

/**
 * Normaliza um texto livre para um slug seguro de URL:
 * minúsculas, sem acentos, só [a-z0-9-], sem hífens duplicados nas pontas.
 * Retorna null se o resultado não couber em [3, 40] chars.
 */
export function normalizeZeloMenuSlug(value: string): string | null {
  const slug = (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return null;
  return slug;
}

/** true se `value` já é um slug canônico (igual à sua forma normalizada). */
export function isValidZeloMenuSlug(value: string): boolean {
  const normalized = normalizeZeloMenuSlug(value);
  return normalized !== null && normalized === value;
}

/** Caminho público (frontend) da loja por slug. */
export function buildPublicStorePath(slug: string): string {
  return `/menu/${encodeURIComponent(slug)}`;
}

/**
 * URL pública branded da loja: raiz limpa `https://menu.zelopdv.com.br/{slug}`
 * (D-006). O subdomínio `menu` serve o slug na raiz; `buildPublicStorePath`
 * (`/menu/{slug}`) continua sendo a rota interna usada em dev e no domínio do app.
 */
export function buildPublicStoreUrl(appBaseUrl: string, slug: string): string {
  return `${appBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(slug)}`;
}

/**
 * Slugs reservados que não podem ser usados por uma loja — colidiriam com rotas
 * existentes (`/menu/carrinho/:token`) ou são confusos como identidade pública.
 */
export const RESERVED_ZELOMENU_SLUGS = new Set([
  'carrinho', 'store', 'stores', 'api', 'app', 'admin', 'menu', 'loja',
  'sobre', 'contato', 'suporte', 'null', 'undefined', 'www', 'auth', 'onboarding',
]);

/** true se o slug normalizado é reservado. */
export function isReservedZeloMenuSlug(slug: string): boolean {
  return RESERVED_ZELOMENU_SLUGS.has(slug);
}
