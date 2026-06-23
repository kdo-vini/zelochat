import assert from 'node:assert/strict';
import {
  resolveZeloMenuCapabilities,
  hasZeloMenuAccess,
  type ZeloMenuEntitlementSignals,
} from '../src/domain/zelomenuEntitlements.js';

// Cobre a "Matriz de entitlement por contrato novo" + os "Test cases de
// domínio/guard obrigatórios" de ZLM-005, e o seam de D-103.
const tests = [
  {
    name: 'sem assinatura ativa não libera nada',
    run() {
      const caps = resolveZeloMenuCapabilities({ planTier: 'chat', active: false });
      assert.deepEqual(
        caps,
        {
          chat_app: false,
          pdv_core: false,
          menu_publication: false,
          public_menu_runtime: false,
          ordering_review: false,
          kitchen_queue: false,
          mesas: false,
          acessos: false,
        },
      );
    },
  },
  {
    name: 'plan_tier nulo não libera nada mesmo "ativo"',
    run() {
      const caps = resolveZeloMenuCapabilities({ planTier: null, active: true });
      assert.equal(caps.chat_app, false);
      assert.equal(caps.menu_publication, false);
    },
  },
  {
    name: "ZeloChat R$147 libera chat_app + ZeloMenu, mas nunca pdv_core",
    run() {
      const caps = resolveZeloMenuCapabilities({ planTier: 'chat', active: true });
      assert.equal(caps.chat_app, true);
      assert.equal(caps.pdv_core, false, 'chat nunca acessa o app ZeloPDV');
      assert.equal(caps.menu_publication, true, 'ZeloMenu incluído por D-014');
      assert.equal(caps.public_menu_runtime, true);
      assert.equal(caps.ordering_review, true);
      assert.equal(caps.kitchen_queue, true);
      assert.equal(caps.mesas, false);
      assert.equal(caps.acessos, false);
    },
  },
  {
    name: 'chat é fail-safe ON mesmo com has_zelo_menu=false (D-103)',
    run() {
      // Coluna nova publicada mas ainda não backfillada para um cliente chat:
      // não pode trancar quem já tem direito por D-014.
      const caps = resolveZeloMenuCapabilities({ planTier: 'chat', active: true, hasZeloMenuFlag: false });
      assert.equal(caps.menu_publication, true);
      assert.equal(hasZeloMenuAccess({ planTier: 'chat', active: true, hasZeloMenuFlag: false }), true);
    },
  },
  {
    name: 'bundle R$197 acessa os dois apps com ZeloMenu completo',
    run() {
      const caps = resolveZeloMenuCapabilities({ planTier: 'bundle', active: true });
      assert.equal(caps.chat_app, true);
      assert.equal(caps.pdv_core, true);
      assert.equal(caps.menu_publication, true);
      assert.equal(caps.ordering_review, true);
      assert.equal(caps.kitchen_queue, true);
    },
  },
  {
    name: 'ZeloPDV puro R$59 sem ZeloMenu não vê publicação nem pedidos online',
    run() {
      const caps = resolveZeloMenuCapabilities({ planTier: 'pdv', active: true });
      assert.equal(caps.pdv_core, true);
      assert.equal(caps.chat_app, false);
      assert.equal(caps.menu_publication, false);
      assert.equal(caps.public_menu_runtime, false);
      assert.equal(caps.ordering_review, false);
      assert.equal(caps.kitchen_queue, false);
    },
  },
  {
    name: 'ZeloPDV + ZeloMenu R$99 libera ZeloMenu via flag nova, sem chat_app',
    run() {
      const caps = resolveZeloMenuCapabilities({ planTier: 'pdv', active: true, hasZeloMenuFlag: true });
      assert.equal(caps.pdv_core, true);
      assert.equal(caps.chat_app, false, 'pdv puro nunca ganha o app ZeloChat');
      assert.equal(caps.menu_publication, true);
      assert.equal(caps.public_menu_runtime, true);
      assert.equal(caps.ordering_review, true);
      assert.equal(caps.kitchen_queue, true);
    },
  },
  {
    name: 'legado has_pedidos_addon libera só pedidos/cozinha, nunca publicação (D-099)',
    run() {
      const signals: ZeloMenuEntitlementSignals = {
        planTier: 'pdv',
        active: true,
        hasPedidosAddonLegacy: true,
      };
      const caps = resolveZeloMenuCapabilities(signals);
      assert.equal(caps.ordering_review, true, 'grandfather mantém revisão de pedidos');
      assert.equal(caps.kitchen_queue, true, 'grandfather mantém cozinha');
      assert.equal(caps.menu_publication, false, 'legado não ganha publicação ZeloMenu');
      assert.equal(caps.public_menu_runtime, false);
      assert.equal(caps.chat_app, false, 'legado não ganha o app ZeloChat');
    },
  },
  {
    name: 'Mesas com cozinha libera kitchen_queue sem ordering_review (D-100)',
    run() {
      const caps = resolveZeloMenuCapabilities({ planTier: 'pdv', active: true, hasMesasAddon: true });
      assert.equal(caps.mesas, true);
      assert.equal(caps.kitchen_queue, true, 'mesa usa cozinha');
      assert.equal(caps.ordering_review, false, 'mesa não implica pedidos online');
      assert.equal(caps.menu_publication, false);
    },
  },
  {
    name: 'addon Acessos é independente',
    run() {
      const caps = resolveZeloMenuCapabilities({ planTier: 'bundle', active: true, hasAcessosAddon: true });
      assert.equal(caps.acessos, true);
      const without = resolveZeloMenuCapabilities({ planTier: 'bundle', active: true });
      assert.equal(without.acessos, false);
    },
  },
];

let failures = 0;

for (const test of tests) {
  try {
    test.run();
    console.log(`ok - ${test.name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${test.name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exit(1);
}
