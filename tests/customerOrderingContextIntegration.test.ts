import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../server/customers/service.ts', import.meta.url), 'utf8');
const router = readFileSync(new URL('../server/customers/router.ts', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../src/components/customers/CustomerDetail.tsx', import.meta.url), 'utf8');

assert.match(service, /CustomerOrderingContext\.get\(\{\s*empresaId,\s*pessoaId:\s*personId\s*\}\)/u);
assert.match(service, /orderingContext/u);
assert.match(router, /createCustomerOrderingContextRouter/u);
assert.match(router, /customerRouter\.use\('\/api\/customers',\s*createCustomerOrderingContextRouter\(\)\)/u);
assert.match(detail, /updateCustomerOrderingOverrides/u);
assert.match(detail, /onUpdateOrderingOverrides/u);
assert.match(detail, /canManage=\{canManage\}/u);

console.log('customerOrderingContextIntegration: ok');
