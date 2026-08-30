export function normalizeWhatsAppTextFormatting(text: string): string {
  return text
    .replace(/\*\*([^*\n](?:[\s\S]*?[^*\n])?)\*\*/g, '*$1*')
    .replace(/__([^_\n](?:[\s\S]*?[^_\n])?)__/g, '_$1_')
    .replace(/~~([^~\n](?:[\s\S]*?[^~\n])?)~~/g, '~$1~');
}
