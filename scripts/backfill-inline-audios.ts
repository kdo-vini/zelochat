/**
 * backfill-inline-audios.ts — one-off retroactive cleanup
 * ============================================================================
 *
 * Antes do fix em server/messageHandler.ts:extractAttachmentDataUrl, o Supabase
 * Storage rejeitava o mime `audio/ogg; codecs=opus` (allowlist do bucket só
 * tem `audio/ogg` puro). O upload jogava exceção, caía no fallback de data URI,
 * e o base64 inteiro do áudio ficava cravado dentro de `zelochat_messages.content`
 * — 5-150 KB por mensagem, infla histórico, deixa abertura de conversa lenta.
 *
 * Este script:
 *   1. Busca rows em `zelochat_messages` cujo `content` é payload estruturado
 *      e cujo `attachment.dataUrl` começa com `data:`.
 *   2. Decoda o base64, sobe pro bucket via `uploadReceivedMedia` (mesma função
 *      do hot path — mime sanitizado, path scoped por empresa).
 *   3. Reescreve só o `dataUrl` dentro do JSON da `content`, mantendo todo o
 *      resto idêntico (text, preview, contentForModel, mimeType original,
 *      fileName, sizeBytes).
 *
 * Idempotente: a query filtra por `data:` no dataUrl. Linhas já migradas
 * (com URL `https://`) não voltam ao loop. Pode rodar várias vezes seguidas
 * sem efeito colateral.
 *
 * Safe-to-fail: erro em uma row loga e segue pra próxima — a mensagem original
 * continua tocável (data URI ainda funciona, só é pesado).
 *
 * Usage:
 *   npx tsx scripts/backfill-inline-audios.ts          # dry-run (default)
 *   npx tsx scripts/backfill-inline-audios.ts --apply  # realmente migra
 *
 * Requer SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY em env. Lê automaticamente
 * de .env (via dotenv).
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar setadas (.env).');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const MEDIA_BUCKET = 'zelochat-media';
const PAGE_SIZE = 50;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface MessageRow {
  id: string;
  empresa_id: string;
  content: string;
  sent_at: string;
}

interface StructuredPayload {
  version: number;
  text: string;
  preview: string;
  contentForModel: string;
  attachment: {
    type: 'image' | 'audio' | 'document' | 'video';
    mimeType: string;
    fileName: string;
    sizeBytes?: number;
    dataUrl?: string;
  };
}

const PREFIX = '__ZELOCHAT_MEDIA__:';

function buildScopedMediaKey(empresaId: string, fileName: string): string {
  const slug = randomBytes(16).toString('hex');
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `received/${empresaId}/${slug}-${safe}`;
}

async function migrateOne(row: MessageRow): Promise<'ok' | 'skip' | 'fail'> {
  if (!row.content.startsWith(PREFIX)) return 'skip';

  let payload: StructuredPayload;
  try {
    payload = JSON.parse(row.content.slice(PREFIX.length));
  } catch {
    console.warn(`  [${row.id}] JSON parse falhou — pulando`);
    return 'fail';
  }

  const dataUrl = payload.attachment?.dataUrl ?? '';
  if (!dataUrl.startsWith('data:')) return 'skip';

  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) {
    console.warn(`  [${row.id}] data URI malformado — pulando`);
    return 'fail';
  }
  const base64 = dataUrl.slice(commaIdx + 1);
  if (!base64) return 'fail';

  // Sanitiza o mime pro Storage (allowlist é estrito) mas preserva o original
  // no payload pra player saber codecs.
  const storageMime = (payload.attachment.mimeType || 'audio/ogg').split(';')[0]?.trim() || 'audio/ogg';
  const fileName = payload.attachment.fileName || 'audio-whatsapp.ogg';
  const key = buildScopedMediaKey(row.empresa_id, fileName);

  if (!APPLY) {
    const sizeKb = Math.round((base64.length * 0.75) / 1024);
    console.log(`  [DRY] ${row.id} (${storageMime}, ~${sizeKb}KB) → ${key}`);
    return 'ok';
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch (err) {
    console.warn(`  [${row.id}] base64 decode falhou:`, err);
    return 'fail';
  }

  const { error: uploadErr } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(key, buffer, { contentType: storageMime, upsert: false });

  if (uploadErr) {
    console.warn(`  [${row.id}] upload falhou:`, uploadErr.message);
    return 'fail';
  }

  const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(key);
  const newDataUrl = urlData.publicUrl;

  const updatedPayload: StructuredPayload = {
    ...payload,
    attachment: { ...payload.attachment, dataUrl: newDataUrl },
  };
  const newContent = `${PREFIX}${JSON.stringify(updatedPayload)}`;

  const { error: updateErr } = await supabase
    .from('zelochat_messages')
    .update({ content: newContent })
    .eq('id', row.id);

  if (updateErr) {
    // Tenta reverter o upload pra não deixar arquivo órfão
    await supabase.storage.from(MEDIA_BUCKET).remove([key]).catch(() => undefined);
    console.warn(`  [${row.id}] update falhou:`, updateErr.message);
    return 'fail';
  }

  console.log(`  [OK] ${row.id} → ${newDataUrl}`);
  return 'ok';
}

async function main() {
  console.log(`[backfill] modo: ${APPLY ? 'APPLY (vai escrever no DB)' : 'DRY-RUN (use --apply pra rodar de verdade)'}`);

  let totalOk = 0;
  let totalFail = 0;
  let totalSkip = 0;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('zelochat_messages')
      .select('id, empresa_id, content, sent_at')
      .like('content', '%"dataUrl":"data:%')
      .order('sent_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('[backfill] query falhou:', error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    console.log(`\n[backfill] processando ${data.length} rows (offset ${offset})…`);

    for (const row of data as MessageRow[]) {
      const result = await migrateOne(row);
      if (result === 'ok') totalOk++;
      else if (result === 'fail') totalFail++;
      else totalSkip++;
    }

    // No modo APPLY, a query da próxima página NÃO traz as rows já migradas
    // (filtro `data:` já não bate), então mantém offset em 0. No DRY-RUN
    // todas as rows continuam aparecendo, então tem que andar com o offset.
    if (!APPLY) offset += data.length;
    if (data.length < PAGE_SIZE) break;
  }

  console.log(`\n[backfill] fim. ok=${totalOk} fail=${totalFail} skip=${totalSkip}`);
  if (!APPLY && totalOk > 0) {
    console.log(`[backfill] re-rode com --apply pra migrar ${totalOk} rows de verdade.`);
  }
}

void main();
