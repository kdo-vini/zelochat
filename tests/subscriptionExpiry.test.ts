import {
  getEffectiveSubscriptionExpiry,
  getEffectiveSubscriptionExpiryMs,
  isSubscriptionCurrentlyActive,
  type ActiveSubscriptionLike,
} from '../src/domain/subscription.js';

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log('  PASS', msg);
    pass++;
  } else {
    console.log('  FAIL', msg);
    fail++;
  }
}

console.log('\nsubscription expiry');

const renewedBundle: ActiveSubscriptionLike = {
  status: 'active',
  current_period_end: '2099-07-11T02:59:59.999Z',
  manually_extended_until: '2026-06-11T02:59:59.999Z',
};

assert(
  getEffectiveSubscriptionExpiry(renewedBundle) === renewedBundle.current_period_end,
  'expired manual extension does not shadow a renewed billing period',
);
assert(
  getEffectiveSubscriptionExpiryMs(renewedBundle) === new Date(renewedBundle.current_period_end as string).getTime(),
  'effective expiry ms comes from the later billing period',
);
assert(
  isSubscriptionCurrentlyActive(renewedBundle),
  'bundle remains active when current_period_end is in the future even if manual extension already expired',
);

const extendedBundle: ActiveSubscriptionLike = {
  ...renewedBundle,
  current_period_end: '2026-07-11T02:59:59.999Z',
  manually_extended_until: '2099-08-11T02:59:59.999Z',
};

assert(
  getEffectiveSubscriptionExpiry(extendedBundle) === extendedBundle.manually_extended_until,
  'future manual extension still extends access beyond the normal billing period',
);

const invalidManual: ActiveSubscriptionLike = {
  ...renewedBundle,
  current_period_end: '2099-09-11T02:59:59.999Z',
  manually_extended_until: 'not-a-date',
};

assert(
  getEffectiveSubscriptionExpiry(invalidManual) === invalidManual.current_period_end,
  'invalid manual extension is ignored in favor of a valid billing period',
);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
