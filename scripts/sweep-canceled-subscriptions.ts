/**
 * sweep-canceled-subscriptions.ts — P1.13 manual sweep entry point
 * ============================================================================
 *
 * Reaps Whatsmiau instances of customers whose subscription has been inactive
 * past the grace window. Same logic the server runs every 6h via
 * startSubscriptionSweepLoop() — exposed as a CLI for ops/dry-run.
 *
 * Usage:
 *   npx tsx scripts/sweep-canceled-subscriptions.ts            # execute
 *   npx tsx scripts/sweep-canceled-subscriptions.ts --dry-run  # preview only
 *   npx tsx scripts/sweep-canceled-subscriptions.ts --grace-days=14  # override
 *
 * Customer data (zelochat_messages, sessions, orders) is preserved. Only the
 * upstream Whatsmiau instance is deleted and `empresa_perfil.whatsmiau_instance`
 * is cleared. If the customer renews, they re-scan QR and get a fresh instance.
 */

import 'dotenv/config';
import { sweepCanceledSubscriptions } from '../server/subscriptionSweeper.js';

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const graceArg = argv.find((a) => a.startsWith('--grace-days='));
  const graceDays = graceArg ? parseInt(graceArg.split('=')[1] ?? '', 10) : undefined;
  return { dryRun, graceDays: Number.isFinite(graceDays) ? graceDays : undefined };
}

async function main() {
  const { dryRun, graceDays } = parseArgs(process.argv.slice(2));
  const result = await sweepCanceledSubscriptions({ dryRun, graceDays });

  console.log('\n[sweeper-cli] result:');
  console.log(`  dryRun:    ${result.dryRun}`);
  console.log(`  scanned:   ${result.scanned}`);
  console.log(`  deleted:   ${result.deleted}`);
  console.log(`  errors:    ${result.errors.length}`);
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      console.error(`    - ${e.instance} (${e.empresaId}): ${e.error}`);
    }
    process.exit(1);
  }
}

void main();
