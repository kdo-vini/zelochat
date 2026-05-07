export type ZeloChatMode = 'restaurant' | 'general';

export const DEFAULT_ZELOCHAT_MODE: ZeloChatMode = 'restaurant';

export function normalizeZeloChatMode(value: unknown): ZeloChatMode {
  return value === 'general' ? 'general' : DEFAULT_ZELOCHAT_MODE;
}

export function isGeneralZeloChatMode(value: unknown): boolean {
  return normalizeZeloChatMode(value) === 'general';
}
