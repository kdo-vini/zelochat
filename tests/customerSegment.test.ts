import assert from 'node:assert/strict';
import {
  CUSTOMER_SEGMENT_CHIPS,
  CUSTOMER_SEGMENT_PRESETS,
  matchesCustomerSegment,
  parseCustomerSegment,
  segmentsEqual,
  type CustomerSegmentSubject,
} from '../src/domain/customerSegment.js';

const tagA = '11111111-1111-4111-8111-111111111111';
const tagB = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-09-09T12:00:00.000Z');
const subject: CustomerSegmentSubject = {
  name: 'Ana Silva',
  phone: '5511999999999',
  orderCount: 3,
  totalValue: 250,
  lastOrderAt: '2026-09-01T12:00:00.000Z',
  tagIds: [tagA, tagB],
  birthdayMonth: 9,
  origin: 'WhatsApp',
};

assert.throws(() => parseCustomerSegment({ unknown: true }), /Filtro não permitido: unknown/);
assert.throws(() => parseCustomerSegment({ minOrders: 4, maxOrders: 2 }), /Faixa de pedidos inválida/);
assert.throws(() => parseCustomerSegment({ tagIds: ['not-a-uuid'] }), /Tags do segmento inválidas/);
assert.throws(() => parseCustomerSegment({ search: 'Ana%Silva' }), /Busca contém caracteres reservados/);
assert.deepEqual(parseCustomerSegment({ search: ' Ana ', buyers: 'buyers', minOrders: 1 }), { search: 'Ana', buyers: 'buyers', minOrders: 1 });

assert.equal(matchesCustomerSegment(subject, { buyers: 'buyers' }, now), true);
assert.equal(matchesCustomerSegment({ ...subject, orderCount: 0 }, { buyers: 'contacts' }, now), true);
assert.equal(matchesCustomerSegment(subject, { buyers: 'contacts' }, now), false);
assert.equal(matchesCustomerSegment(subject, { minOrders: 3, maxOrders: 3, minTotalValue: 250 }, now), true);
assert.equal(matchesCustomerSegment(subject, { minDaysSinceLastOrder: 8 }, now), true);
assert.equal(matchesCustomerSegment(subject, { maxDaysSinceLastOrder: 8 }, now), true);
assert.equal(matchesCustomerSegment({ ...subject, lastOrderAt: null, orderCount: 0 }, { minDaysSinceLastOrder: 1 }, now), false);
assert.equal(matchesCustomerSegment({ ...subject, phone: null }, { hasWhatsApp: false }, now), true);
assert.equal(matchesCustomerSegment(subject, { tagIds: [tagA, tagB] }, now), true);
assert.equal(matchesCustomerSegment({ ...subject, tagIds: [tagA] }, { tagIds: [tagA, tagB] }, now), false);
assert.equal(matchesCustomerSegment(subject, { birthdayMonth: 9, origin: 'whatsapp', search: 'ANA' }, now), true);
assert.equal(matchesCustomerSegment({ ...subject, lastOrderAt: 'invalid' }, { maxDaysSinceLastOrder: 30 }, now), false);

for (const preset of CUSTOMER_SEGMENT_PRESETS) assert.deepEqual(parseCustomerSegment(preset.segment), preset.segment);
assert.deepEqual(CUSTOMER_SEGMENT_CHIPS.map((preset) => preset.id), ['sumiram', 'uma-vez', 'melhores']);
assert.equal(CUSTOMER_SEGMENT_CHIPS[0], CUSTOMER_SEGMENT_PRESETS.find((preset) => preset.id === 'sumiram'));
assert.equal(segmentsEqual({ tagIds: [tagA, tagB] }, { tagIds: [tagB, tagA] }), true);
assert.equal(segmentsEqual({}, { search: undefined }), true);
assert.equal(segmentsEqual({ tagIds: [] }, { tagIds: undefined }), true);
assert.equal(segmentsEqual({ tagIds: [tagA] }, { tagIds: [tagB] }), false);
console.log('customerSegment: ok');
