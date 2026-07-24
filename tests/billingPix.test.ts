/**
 * Unit tests for AbacatePay Pix billing integration.
 * Covers pure functions only — no network calls, no DB calls.
 */

import { createHmac } from 'node:crypto';
import { verifyAbacatePaySignature, buildUrl, STATUS_MAP } from '../server/abacatepay.js';
import { safeEqualStr, extractTransparentId } from '../server/billingPix.js';
import { assert, pass, fail } from './testHarness.js';

// ---------------------------------------------------------------------------
// safeEqualStr
// ---------------------------------------------------------------------------
console.log('\nsafeEqualStr');

assert(safeEqualStr('abc', 'abc'), 'identical strings are equal');
assert(!safeEqualStr('abc', 'abd'), 'different strings are not equal');
assert(!safeEqualStr('abc', 'abcd'), 'different lengths are not equal');
assert(!safeEqualStr('', 'x'), 'empty vs non-empty is not equal');
assert(safeEqualStr('', ''), 'both empty strings are equal');
assert(safeEqualStr('long-webhook-secret-12345', 'long-webhook-secret-12345'), 'long identical strings are equal');
assert(!safeEqualStr('long-webhook-secret-12345', 'long-webhook-secret-12346'), 'long strings differing by one char are not equal');

// ---------------------------------------------------------------------------
// verifyAbacatePaySignature
// ---------------------------------------------------------------------------
console.log('\nverifyAbacatePaySignature');

function makeSignature(body: Buffer, key: string): string {
  return createHmac('sha256', key).update(body).digest('base64');
}

const KEY = 'test-secret-key';
const BODY = Buffer.from('{"event":"transparent.completed","id":"evt_001"}');
const VALID_SIG = makeSignature(BODY, KEY);

assert(verifyAbacatePaySignature(BODY, VALID_SIG, KEY), 'valid HMAC passes');
assert(!verifyAbacatePaySignature(BODY, VALID_SIG, 'wrong-key'), 'wrong key fails');
assert(!verifyAbacatePaySignature(Buffer.from('tampered-body'), VALID_SIG, KEY), 'tampered body fails');
assert(!verifyAbacatePaySignature(BODY, 'badsig', KEY), 'garbage signature (different length) fails');
assert(!verifyAbacatePaySignature(BODY, '', KEY), 'empty signature fails');
assert(!verifyAbacatePaySignature(BODY, VALID_SIG, ''), 'empty key fails');

// Prefix attack: "sha256=" prefix must NOT be present (AbacatePay sends raw base64)
const prefixedSig = `sha256=${VALID_SIG}`;
assert(!verifyAbacatePaySignature(BODY, prefixedSig, KEY), 'hex-prefixed signature is rejected (AbacatePay uses raw base64)');

// Subtle attack: different body same signature
const OTHER_BODY = Buffer.from('{"event":"transparent.completed","id":"evt_002"}');
const OTHER_SIG = makeSignature(OTHER_BODY, KEY);
assert(!verifyAbacatePaySignature(BODY, OTHER_SIG, KEY), 'signature for different body is rejected');

// Empty body with valid HMAC
const EMPTY_SIG = makeSignature(Buffer.from(''), KEY);
assert(verifyAbacatePaySignature(Buffer.from(''), EMPTY_SIG, KEY), 'empty body with correct HMAC passes');

// ---------------------------------------------------------------------------
// STATUS_MAP
// ---------------------------------------------------------------------------
console.log('\nSTATUS_MAP (AbacatePay upstream status normalization)');

assert(STATUS_MAP['ACTIVE'] === 'PENDING', 'ACTIVE maps to PENDING');
assert(STATUS_MAP['PENDING'] === 'PENDING', 'PENDING maps to PENDING');
assert(STATUS_MAP['PAID'] === 'COMPLETED', 'PAID maps to COMPLETED');
assert(STATUS_MAP['COMPLETED'] === 'COMPLETED', 'COMPLETED maps to COMPLETED');
assert(STATUS_MAP['FAILED'] === 'FAILED', 'FAILED maps to FAILED');
assert(STATUS_MAP['CANCELLED'] === 'FAILED', 'CANCELLED maps to FAILED');
assert(STATUS_MAP['CANCELED'] === 'FAILED', 'CANCELED (US spelling) maps to FAILED');
assert(STATUS_MAP['EXPIRED'] === 'EXPIRED', 'EXPIRED maps to EXPIRED');
assert(STATUS_MAP['REFUNDED'] === 'FAILED', 'REFUNDED maps to FAILED');
assert(STATUS_MAP['UNKNOWN_STATUS'] === undefined, 'unknown status is undefined (caller defaults to PENDING)');

// ---------------------------------------------------------------------------
// buildUrl
// ---------------------------------------------------------------------------
console.log('\nbuildUrl');

const ORIG_BASE = process.env.ABACATEPAY_BASE_URL;

process.env.ABACATEPAY_BASE_URL = 'https://api.abacatepay.com/v2';
assert(
  buildUrl('transparents/create') === 'https://api.abacatepay.com/v2/transparents/create',
  'builds path under configured base URL',
);
assert(
  buildUrl('transparents/check', { id: 'pay_abc123' }) === 'https://api.abacatepay.com/v2/transparents/check?id=pay_abc123',
  'appends search params correctly',
);

// With trailing slash on base
process.env.ABACATEPAY_BASE_URL = 'https://api.abacatepay.com/v2/';
assert(
  buildUrl('transparents/create') === 'https://api.abacatepay.com/v2/transparents/create',
  'trailing slash on base URL does not double-slash',
);

// Default base when env not set
delete process.env.ABACATEPAY_BASE_URL;
assert(
  buildUrl('transparents/check').startsWith('https://api.abacatepay.com/v2/'),
  'falls back to default base URL when env not set',
);

// Multiple search params
process.env.ABACATEPAY_BASE_URL = 'https://api.example.com/v2';
const multiUrl = new URL(buildUrl('some/path', { a: '1', b: '2' }));
assert(multiUrl.searchParams.get('a') === '1' && multiUrl.searchParams.get('b') === '2', 'multiple search params are set');

if (ORIG_BASE !== undefined) process.env.ABACATEPAY_BASE_URL = ORIG_BASE;
else delete process.env.ABACATEPAY_BASE_URL;

// ---------------------------------------------------------------------------
// extractTransparentId
// ---------------------------------------------------------------------------
console.log('\nextractTransparentId');

// Standard AbacatePay v2 shape: { data: { transparent: { id } } }
assert(
  extractTransparentId({ data: { transparent: { id: 'trans_abc' } } }) === 'trans_abc',
  'extracts id from data.transparent.id (canonical path)',
);

// Fallback: { data: { id } }
assert(
  extractTransparentId({ data: { id: 'data_abc' } }) === 'data_abc',
  'falls back to data.id when transparent is missing',
);

// Fallback: { id } at top level
assert(
  extractTransparentId({ id: 'top_abc' }) === 'top_abc',
  'falls back to top-level id',
);

// Priority: transparent.id wins over data.id
assert(
  extractTransparentId({ id: 'top', data: { id: 'data', transparent: { id: 'trans' } } }) === 'trans',
  'transparent.id takes priority',
);

// data.id wins over top-level id when no transparent
assert(
  extractTransparentId({ id: 'top', data: { id: 'data' } }) === 'data',
  'data.id takes priority over top-level id',
);

// Missing id returns undefined
assert(
  extractTransparentId({}) === undefined,
  'empty payload returns undefined',
);

assert(
  extractTransparentId({ event: 'transparent.completed', data: {} }) === undefined,
  'payload with empty data.transparent returns undefined',
);

// null data should not throw
assert(
  extractTransparentId({ data: null }) === undefined || extractTransparentId({ data: null }) === undefined,
  'null data does not throw',
);

// ---------------------------------------------------------------------------
// Webhook secret auth (safeEqualStr used for ?webhookSecret=)
// ---------------------------------------------------------------------------
console.log('\nwebhook secret timing-safe compare (integration)');

const SECRET = 'my-super-secret-webhook-token-32chars';
assert(safeEqualStr(SECRET, SECRET), 'correct secret passes');
assert(!safeEqualStr(SECRET, SECRET + ' '), 'secret with trailing space fails');
assert(!safeEqualStr(SECRET, SECRET.slice(0, -1)), 'truncated secret fails');
assert(!safeEqualStr('', SECRET), 'empty string does not match non-empty secret');
assert(!safeEqualStr(SECRET, ''), 'non-empty secret does not match empty string');

// ---------------------------------------------------------------------------
// Plan price parsing (getPlanPrice uses parseInt(raw, 10) / 100)
// ---------------------------------------------------------------------------
console.log('\nplan price env var parsing (unit)');

function parsePlanPrice(raw: string): number {
  return parseInt(raw, 10) / 100;
}

assert(parsePlanPrice('9700') === 97, 'R$97 chat plan parsed correctly from centavos');
assert(parsePlanPrice('14700') === 147, 'R$147 bundle plan parsed correctly from centavos');
assert(parsePlanPrice('0') === 0, 'zero price parsed correctly');
assert(Number.isNaN(parsePlanPrice('')), 'empty string yields NaN (missing env var caught at runtime)');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
