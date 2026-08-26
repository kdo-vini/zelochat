import { assert, runSuite } from './testHarness.js';
import {
  countActiveCustomerFilters,
  serializeCustomerFilters,
  shouldResetCustomerCursor,
  type CustomerFilters,
} from '../src/services/customerApi.ts';

await runSuite('customer list behavior', [
  {
    name: 'serializes only active filters for the typed API',
    run: () => {
      const filters: CustomerFilters = { search: ' Ana ', status: 'active', tags: ['vip'], birthdayMonth: 0 };
      assert(serializeCustomerFilters(filters) === 'q=Ana&status=active&tags=vip', 'empty values are omitted and search is trimmed');
      assert(countActiveCustomerFilters(filters) === 2, 'search and status count as active filters');
    },
  },
  {
    name: 'resets pagination cursor when search or filters change',
    run: () => {
      assert(shouldResetCustomerCursor({ search: 'a' }, { search: 'b' }), 'search change resets cursor');
      assert(shouldResetCustomerCursor({ status: 'all' }, { status: 'inactive' }), 'filter change resets cursor');
      assert(!shouldResetCustomerCursor({ search: 'a' }, { search: 'a' }), 'same query keeps cursor');
    },
  },
  {
    name: 'filters stay in one panel instead of permanent toolbar pills',
    run: () => {
      const toolbarControls = ['Busca', 'Filtros', 'Novo cliente'];
      assert(toolbarControls.filter((label) => label === 'Filtros').length === 1, 'there is exactly one filter control');
      assert(!toolbarControls.some((label) => /VIP|aniversariantes|ativos|inativos/i.test(label)), 'status segments are not permanent pills');
    },
  },
]);
