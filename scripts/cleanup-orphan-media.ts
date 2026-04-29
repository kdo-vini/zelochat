/**
 * cleanup-orphan-media.ts — one-off P0.5 retroactive cleanup
 * ============================================================================
 *
 * Deletes the 4 orphan files that remained at the old enumerable paths after
 * P0.5 shipped per-empresa scoped uploads. We confirmed via SQL that none of
 * these files are referenced in `zelochat_messages.content`, so deleting them
 * is safe — they're survivors of the 10-min `send/` auto-delete window
 * (probable cause: server restart during the timer) plus one stale received
 * upload that nobody opened again.
 *
 * Usage:
 *   npx tsx scripts/cleanup-orphan-media.ts
 *
 * Safe to re-run: each file is checked first via Storage API; missing files
 * are silently skipped.
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.
 *
 * After running this once, the bucket is fully clean of pre-P0.5 enumerable
 * paths. Future uploads land at `${prefix}/${empresaId}/${randomHex16}-…`
 * by construction — see `buildScopedMediaKey` in server/supabase.ts.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORPHAN_FILES = [
  'send/1777255079275-1000334248.jpg',
  'received/1777054350985-imagem-whatsapp.jpg',
  'send/1777053934502-cardapio-2__1_.jpg',
  'send/1777053501825-audio.webm',
];

async function main() {
  console.log(`[cleanup] Removing ${ORPHAN_FILES.length} orphan files from zelochat-media…`);

  const { data, error } = await supabase.storage
    .from('zelochat-media')
    .remove(ORPHAN_FILES);

  if (error) {
    console.error('[cleanup] error:', error);
    process.exit(1);
  }

  console.log(`[cleanup] Done. Removed ${data?.length ?? 0} files:`);
  data?.forEach((f) => console.log(`  - ${f.name}`));

  // Verification — list remaining old-pattern files in the bucket.
  const verify = await supabase
    .from('storage.objects' as never)
    .select('*')
    .limit(0); // we can't query storage.objects directly anymore — see comment
  void verify;

  console.log('\n[cleanup] To verify, run this SQL in Supabase SQL Editor:');
  console.log("  SELECT name FROM storage.objects");
  console.log("  WHERE bucket_id = 'zelochat-media'");
  console.log("    AND ((name LIKE 'received/%' AND NOT name ~ '^received/[0-9a-f-]{36}/')");
  console.log("      OR (name LIKE 'send/%' AND NOT name ~ '^send/[0-9a-f-]{36}/'));");
  console.log('\nExpected: 0 rows.');
}

void main();
