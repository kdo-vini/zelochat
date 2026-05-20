export const APP_VERSION: string = __ZELO_BUILD_VERSION__;

export function normalizeVersion(value: unknown): string {
  return String(value ?? '').trim();
}
