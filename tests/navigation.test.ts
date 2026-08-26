import { assert, runSuite } from './testHarness.js';
import {
  getDesktopNavigation,
  getMobileNavigation,
} from '../src/domain/navigation.ts';

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

await runSuite('navigation configuration', [
  {
    name: 'uses one definition for the desktop operation order',
    run: () => {
      const desktop = getDesktopNavigation('restaurant', { pessoas: { visualizar: true }, rollout: { crm: true } });
      assert(
        JSON.stringify(ids(desktop.primary)) === JSON.stringify(['dashboard', 'chat', 'customers', 'kanban', 'drivers']),
        'desktop operation order includes Clientes between Atendimento and Produção',
      );
    },
  },
  {
    name: 'keeps mobile restaurant navigation to four destinations',
    run: () => {
      const mobile = getMobileNavigation('restaurant', { pessoas: { visualizar: true }, rollout: { crm: true } });
      assert(
        JSON.stringify(ids(mobile.primary)) === JSON.stringify(['chat', 'customers', 'kanban']),
        'restaurant mobile primary tabs are Atendimento, Clientes and Produção',
      );
      assert(mobile.more.some((item) => item.id === 'dashboard' && item.label === 'Métricas'), 'Métricas is inside Mais');
    },
  },
  {
    name: 'keeps mobile general navigation to three destinations',
    run: () => {
      const mobile = getMobileNavigation('general', { pessoas: { visualizar: true }, rollout: { crm: true } });
      assert(JSON.stringify(ids(mobile.primary)) === JSON.stringify(['chat', 'customers']), 'general mobile primary tabs are Atendimento and Clientes');
      assert(!mobile.primary.some((item) => item.id === 'kanban'), 'Produção is hidden in general mode');
    },
  },
  {
    name: 'requires customer visibility permission',
    run: () => {
      const withoutPermission = getMobileNavigation('restaurant', { pessoas: { visualizar: false } });
      const withPermission = getMobileNavigation('restaurant', { pessoas: { visualizar: true }, rollout: { crm: true } });
      assert(!withoutPermission.primary.some((item) => item.id === 'customers'), 'Clientes is hidden without pessoas.visualizar');
      assert(withPermission.primary.some((item) => item.id === 'customers'), 'Clientes is visible with pessoas.visualizar');
    },
  },
  {
    name: 'marks Mais active for any destination contained by its sheet',
    run: () => {
      const mobile = getMobileNavigation('restaurant');
      assert(mobile.more.some((item) => item.id === 'dashboard'), 'Mais owns dashboard');
      assert(mobile.more.some((item) => item.id === 'settings'), 'Mais owns settings');
      assert(mobile.moreActiveViews.has('dashboard'), 'dashboard activates Mais');
    },
  },
]);
