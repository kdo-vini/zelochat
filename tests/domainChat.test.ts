import {
  buildContactKey,
  buildContentForModel,
  maskBrazilianPhone,
  maskTime24h,
  normalizeWhatsAppTextFormatting,
  parseStructuredMessage,
  serializeStructuredMessage,
} from '../src/domain/chat.js';
import type { ChatAttachment, ChatMessage } from '../src/types.js';
import { assert, assertEqual, runSuite } from './testHarness.js';

const imageAttachment: ChatAttachment = {
  type: 'image',
  fileName: 'foto.jpg',
  mimeType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,AAAA',
};

await runSuite('Chat domain utilities', [
  {
    name: 'contact key groups Brazilian mobile variants',
    run: () => {
      assertEqual(
        buildContactKey('55 14 99836-0854'),
        buildContactKey('(14) 9836-0854'),
        'country-code and 9th-digit variants map to the same family',
      );
      assertEqual(
        buildContactKey('(14) 3333-4444'),
        '1433334444',
        'landline-style numbers are not stripped as mobile 9th digit',
      );
    },
  },
  {
    name: 'phone and time masks stay format-only',
    run: () => {
      assertEqual(maskBrazilianPhone('14998360854'), '(14) 99836-0854', 'mobile mask uses 5-digit prefix');
      assertEqual(maskBrazilianPhone('1433334444'), '(14) 3333-4444', 'landline mask uses 4-digit prefix');
      assertEqual(maskTime24h('930'), '93:0', 'time mask only formats typed digits and does not invent validity');
    },
  },
  {
    name: 'WhatsApp text formatting avoids double-asterisk markdown',
    run: () => {
      assertEqual(
        normalizeWhatsAppTextFormatting('**Pedido confirmado** e __nome__ ~~errado~~'),
        '*Pedido confirmado* e _nome_ ~errado~',
        'markdown-ish formatting is converted to WhatsApp formatting',
      );
    },
  },
  {
    name: 'structured media messages preserve preview and attachment',
    run: () => {
      const serialized = serializeStructuredMessage({
        text: '**Olha essa foto**',
        attachment: imageAttachment,
      });
      const parsed = parseStructuredMessage(serialized);
      assertEqual(parsed.kind, 'image', 'image kind survives serialization');
      assertEqual(parsed.text, '*Olha essa foto*', 'caption is normalized for WhatsApp');
      assertEqual(parsed.preview, '[Imagem] *Olha essa foto*', 'image preview includes normalized caption');
      assert(parsed.attachment?.dataUrl === imageAttachment.dataUrl, 'attachment data URL survives serialization');
    },
  },
  {
    name: 'invalid structured payload falls back to text',
    run: () => {
      const parsed = parseStructuredMessage('__ZELOCHAT_MEDIA__:{broken json');
      assertEqual(parsed.kind, 'text', 'broken structured payload is treated as text');
      assert(parsed.contentForModel.includes('__ZELOCHAT_MEDIA__'), 'raw content is preserved for diagnosis');
    },
  },
  {
    name: 'audio transcript is what the AI sees when available',
    run: () => {
      const msg = {
        id: 'm1',
        role: 'user',
        kind: 'audio',
        content: '[Áudio]',
        preview: '[Áudio]',
        audio_transcript_status: 'done',
        audio_transcript: 'quero dois refrigerantes',
      } as unknown as ChatMessage;
      assertEqual(
        buildContentForModel(msg),
        '[Áudio: "quero dois refrigerantes"]',
        'completed audio transcript replaces placeholder',
      );
    },
  },
]);
