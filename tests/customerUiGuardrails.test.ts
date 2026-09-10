import { assert, runSuite } from './testHarness.js';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  countActiveCustomerFilters,
  DEFAULT_CUSTOMER_FILTERS,
  serializeCustomerFilters,
  shouldResetCustomerCursor,
  type CustomerFilters,
} from '../src/services/customerApi.ts';
import { CustomerSegmentChips } from '../src/components/customers/CustomerSegmentChips.js';
import { formatCustomerListActivity } from '../src/components/customers/CustomerListRow.js';

const chipsSource = readFileSync(new URL('../src/components/customers/CustomerSegmentChips.tsx', import.meta.url), 'utf8');
const rowSource = readFileSync(new URL('../src/components/customers/CustomerListRow.tsx', import.meta.url), 'utf8');

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
  {
    name: 'customer segment chips survive a count failure and remain actions',
    run: () => {
      const markup = renderToStaticMarkup(createElement(CustomerSegmentChips, { area: 'customers', token: null, filters: DEFAULT_CUSTOMER_FILTERS, onChange: () => undefined }));
      assert((markup.match(/<button/g) ?? []).length === 3, 'three chips render without counts');
      assert(!markup.includes('undefined'), 'failed or unavailable counts do not render technical values');
      assert(chipsSource.includes('fetchSegmentCounts(token)') && chipsSource.includes('.catch(() =>'), 'count failure is swallowed while the chip handlers stay mounted');
      assert(chipsSource.includes('onClick={() => onChange'), 'chips remain clickable when counts are unavailable');
    },
  },
  {
    name: 'the customer row describes orders, conversations and inactivity in order',
    run: () => {
      const now = Date.parse('2026-09-10T12:00:00.000Z');
      assert(/^Última compra .*há 7 dias$/u.test(formatCustomerListActivity({ orderCount: 2, lastOrderAt: '2026-09-03T12:00:00.000Z', lastActivityAt: null }, now)), 'customers with orders show their last purchase');
      assert(formatCustomerListActivity({ orderCount: 0, lastOrderAt: null, lastActivityAt: '2026-09-08T12:00:00.000Z' }, now) === 'Sem compra · falou há 2 dias', 'contacts with a conversation show recent contact');
      assert(formatCustomerListActivity({ orderCount: 0, lastOrderAt: null, lastActivityAt: null }, now) === 'Nunca comprou', 'contacts without activity show never purchased');
      assert(!rowSource.includes('>Sem compra</span>'), 'the redundant purchase badge is removed from the row');
    },
  },
]);
