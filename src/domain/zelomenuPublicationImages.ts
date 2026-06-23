export const ZELOMENU_PUBLICATION_IMAGE_BUCKET = 'logos';
export const ZELOMENU_PUBLICATION_IMAGE_PREFIX = 'zelomenu-products';

export function sanitizeZeloMenuPublicationImageFileName(fileName: string): string {
  const trimmed = fileName.trim().toLowerCase();
  const safe = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return safe || 'produto.jpg';
}

export function buildZeloMenuPublicationImagePath(userId: string, productId: number, fileName: string): string {
  const safeFileName = sanitizeZeloMenuPublicationImageFileName(fileName);
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${ZELOMENU_PUBLICATION_IMAGE_PREFIX}/${userId}/${productId}-${unique}-${safeFileName}`;
}

export function getOwnedZeloMenuPublicationImagePath(url: string | null | undefined): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${ZELOMENU_PUBLICATION_IMAGE_BUCKET}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return null;
    const objectPath = decodeURIComponent(parsed.pathname.slice(index + marker.length));
    if (!objectPath.startsWith(`${ZELOMENU_PUBLICATION_IMAGE_PREFIX}/`)) return null;
    return objectPath;
  } catch {
    return null;
  }
}
