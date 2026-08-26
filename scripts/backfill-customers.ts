import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createSupabaseBackfillDependencies, runCustomerBackfill } from '../server/customers/backfill.js';

const empresaArg = process.argv.find((arg) => arg.startsWith('--empresa='))?.slice('--empresa='.length) ?? '';
const dryRun = process.argv.includes('--dry-run');
if (!empresaArg) { console.error('Informe --empresa=<uuid>.'); process.exit(1); }
if (!dryRun) {
  const rl = createInterface({ input, output });
  const answer = await rl.question(`Digite ${empresaArg} para confirmar o backfill: `);
  rl.close();
  if (answer.trim() !== empresaArg) { console.error('Confirmação não corresponde à empresa.'); process.exit(1); }
}
const result = await runCustomerBackfill({ empresaId: empresaArg, dryRun, dependencies: createSupabaseBackfillDependencies(empresaArg) });
console.log(JSON.stringify({ empresaId: empresaArg, dryRun, ...result }));
