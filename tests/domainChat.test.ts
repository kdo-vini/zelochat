import {
  buildContactKey,
  buildContentForModel,
  maskBrazilianPhone,
  maskTime24h,
  normalizeWhatsAppTextFormatting,
  parseStructuredMessage,
  serializeInteractiveMessage,
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
 {
    // REGRESSION 2026-09-09: an outbound button message was persisted as its
    // text alone, so the conversation view could not show whether the buttons
    // went out and the operator had no way to tell.
    name: 'interactive controls survive the round trip',
    run: () => {
      const content = serializeInteractiveMessage({
        text: 'Olá! Veja o cardápio e faça seu pedido por aqui: https://menu.zelopdv.com.br/bemservido',
        interactive: { kind: 'buttons', options: [{ id: 'AI_ORDER_START', label: 'Pedir por aqui' }] },
      });
      const parsed = parseStructuredMessage(content);
      assertEqual(parsed.interactive?.kind, 'buttons', 'controls are read back');
      assertEqual(parsed.interactive?.options[0]?.label, 'Pedir por aqui', 'the label the customer tapped');
      assert(parsed.text.includes('Veja o cardápio'), 'the text is unchanged');
      // The session list and the AI history must read exactly what they read
      // before this envelope existed.
      assertEqual(parsed.preview, parsed.text, 'preview stays the plain text');
      assertEqual(parsed.contentForModel, parsed.text, 'the model still sees only the words');
      assertEqual(parsed.kind, 'text', 'an attachment-less envelope is still a text message');
      assertEqual(parsed.attachment, undefined, 'no attachment invented');
    },
  },
  {
    name: 'list rows keep their section and description',
    run: () => {
      const parsed = parseStructuredMessage(serializeInteractiveMessage({
        text: 'Escolha a mistura',
        interactive: {
          kind: 'list',
          options: [{ id: 'REQ:a|b|c', label: 'Frango', description: 'Filé empanado', section: '4. Escolha a mistura' }],
        },
      }));
      assertEqual(parsed.interactive?.options[0]?.section, '4. Escolha a mistura', 'section survives');
      assertEqual(parsed.interactive?.options[0]?.description, 'Filé empanado', 'description survives');
    },
  },
  {
    name: 'a message with no controls is stored as plain text',
    run: () => {
      const content = serializeInteractiveMessage({
        text: 'Bom dia!',
        interactive: { kind: 'buttons', options: [] },
      });
      assertEqual(content, 'Bom dia!', 'no envelope when there is nothing to record');
      assertEqual(parseStructuredMessage(content).interactive, undefined, 'nothing to render');
    },
  },
]);