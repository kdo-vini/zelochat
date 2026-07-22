import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tsxCli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));

const tests = [
  'tests/auditFixGuardrails.test.ts',
  'tests/aiSchedule.test.ts',
  'tests/businessHours.test.ts',
  'tests/configStore.test.ts',
  'tests/conversationState.test.ts',
  'tests/conversationEdgeCases.test.ts',
  'tests/orderEventTriggers.test.ts',
  'tests/domainChat.test.ts',
  'tests/errorMessages.test.ts',
  'tests/pixReceipt.test.ts',
  'tests/replyDebouncer.test.ts',
  'tests/replyDebouncer-disabled.test.ts',
  'tests/audioTranscriptionRearm.test.ts',
  'tests/aiRouteGuards.test.ts',
  'tests/aiZeloMenuGuardrails.test.ts',
  'tests/aiToolPlan.test.ts',
  'tests/aiSimulatorScheduleGuard.test.ts',
  'tests/aiPromptGuardrails.test.ts',
  'tests/aiTurnDecision.test.ts',
  'tests/routerWebhookGuardrails.test.ts',
  'tests/zelomenuCart.test.ts',
  'tests/zelomenuCheckout.test.ts',
  'tests/zelomenuPublicCheckoutGuardrails.test.ts',
  'tests/zelomenuStoreCartCache.test.ts',
  'tests/zelomenuReviewGuardrails.test.ts',
  'tests/zelomenuAbandonedCart.test.ts',
  'tests/zelomenuModifiers.test.ts',
  'tests/zelomenuPublicationImages.test.ts',
  'tests/zelomenuPublication.test.ts',
  'tests/zelomenuEntitlements.test.ts',
  'tests/zelomenuSlug.test.ts',
  'tests/canonicalOrders.test.ts',
  'tests/updateReloadGuardrails.test.ts',
  'tests/billingPix.test.ts',
  'tests/subscriptionExpiry.test.ts',
];

if (!existsSync(tsxCli)) {
  console.error(`tsx CLI not found at ${tsxCli}. Run npm install first.`);
  process.exit(1);
}

let failures = 0;

for (const testFile of tests) {
  console.log(`\n===== ${testFile} =====`);
  const result = spawnSync(process.execPath, [tsxCli, testFile], {
    stdio: 'inherit',
    env: {
      ...process.env,
      WHATSMIAU_DISABLE_WEBHOOK_REGISTER: '1',
      ZELOCHAT_DISABLE_WHATSAPP_NETWORK: '1',
    },
  });
  if (result.status !== 0) {
    failures++;
    console.error(`\n${testFile} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} test file(s) failed.`);
  process.exit(1);
}

console.log('\nAll unit test files passed.');
