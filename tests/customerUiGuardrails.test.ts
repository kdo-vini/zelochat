import { assert, runSuite } from './testHarness.js';
import {
  countActiveCustomerFilters,
  DEFAULT_CUSTOMER_FILTERS,
  serializeCustomerFilters,
  shouldResetCustomerCursor,
  type CustomerFilters,
} from '../src/services/customerApi.ts';

await runSuite('customer list behavior', [
  {
    name: 'serializes only active segment criteria for the typed API',
    run: () => {
      const filters: CustomerFilters = { search: ' Ana ', segment: { buyers: 'buyers', minOrders: 3, hasWhatsApp: true }, sort: 'value' };
      assert(serializeCustomerFilters(filters) === 'q=Ana&buyers=buyers&minOrders=3&hasWhatsApp=true&sort=value', 'empty values are omitted and search is trimmed');
      assert(countActiveCustomerFilters(filters) === 2, 'minOrders and hasWhatsApp count as active filters; default buyers scope does not');
    },
  },
  {
    name: 'resets pagination cursor when search, segment or sort changes',
    run: () => {
      assert(shouldResetCustomerCursor({ search: 'a' }, { search: 'b' }), 'search change resets cursor');
      assert(shouldResetCustomerCursor({ segment: { buyers: 'buyers' } }, { segment: { buyers: 'all' } }), 'segment change resets cursor');
      assert(shouldResetCustomerCursor({ sort: 'orders' }, { sort: 'recent' }), 'sort change resets cursor');
      assert(!shouldResetCustomerCursor({ search: 'a', sort: 'orders' }, { search: 'a', sort: 'orders' }), 'same query keeps cursor');
    },
  },
  {
    name: 'filters stay in one panel instead of permanent toolbar pills',
    run: () => {
      const toolbarControls = ['Busca', 'Ordenar por', 'Filtros', 'Novo cliente'];
      assert(toolbarControls.filter((label) => label === 'Filtros').length === 1, 'there is exactly one filter control');
      assert(!toolbarControls.some((label) => /VIP|aniversariantes|ativos|inativos/i.test(label)), 'status segments are not permanent pills');
    },
  },
  {
    name: 'default query opens on buyers ranked by most orders, with no active filter badge',
    run: () => {
      assert(DEFAULT_CUSTOMER_FILTERS.sort === 'orders', 'default sort is most orders');
      assert(DEFAULT_CUSTOMER_FILTERS.segment?.buyers === 'buyers', 'default scope is customers who already bought');
      assert(countActiveCustomerFilters(DEFAULT_CUSTOMER_FILTERS) === 0, 'the default query itself is not shown as an active filter');
    },
  },
]);
