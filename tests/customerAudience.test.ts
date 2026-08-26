import assert from 'node:assert/strict';
import { parseSegmentDefinition, evaluateAudience, type AudiencePerson } from '../server/campaigns/filters.js';

assert.deepEqual(parseSegmentDefinition({ activityState: 'active', hasPhone: true, minOrders: 2 }), {
  activityState: 'active', hasPhone: true, minOrders: 2,
});
assert.throws(() => parseSegmentDefinition({ sql: 'select * from pessoas' }));
assert.throws(() => parseSegmentDefinition({ activityState: 'unknown' }));

const people: AudiencePerson[] = [
  { id: 'p1', name: 'Ana', phone: '5511999999999', activityState: 'active', orderCount: 3, totalValue: 350, isEmployee: false, hasConflict: false, blocked: false, optedOut: false },
  { id: 'p2', name: 'Bia', phone: null, activityState: 'active', orderCount: 4, totalValue: 400, isEmployee: false, hasConflict: false, blocked: false, optedOut: false },
  { id: 'p3', name: 'Caio', phone: '5511888888888', activityState: 'inactive', orderCount: 4, totalValue: 400, isEmployee: false, hasConflict: true, blocked: false, optedOut: false },
];
const result = evaluateAudience(people, { activityState: 'active', minOrders: 2 });
assert.deepEqual(result.eligible.map((person) => person.id), ['p1']);
assert.deepEqual(result.suppressed.map((person) => [person.id, person.suppressionReason]), [['p2', 'sem_telefone']]);
console.log('customerAudience: ok');
