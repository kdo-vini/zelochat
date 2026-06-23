import assert from 'node:assert/strict';
import {
  formatModifierAwareCartItem,
  resolveModifierSelections,
  validateModifierGroupDrafts,
  type ZeloMenuModifierGroup,
} from '../src/domain/zelomenuModifiers.js';

const groups: ZeloMenuModifierGroup[] = [
  {
    id: 'group-1',
    productId: 1,
    name: 'Escolha o recheio',
    kind: 'variacao',
    minSelections: 1,
    maxSelections: 1,
    active: true,
    order: 0,
    options: [
      { id: 'option-1', name: 'Frango', priceDelta: 0, active: true, order: 0 },
      { id: 'option-2', name: 'Carne', priceDelta: 2, active: true, order: 1 },
    ],
  },
  {
    id: 'group-2',
    productId: 1,
    name: 'Adicionais',
    kind: 'adicional',
    minSelections: 0,
    maxSelections: 2,
    active: true,
    order: 1,
    options: [
      { id: 'option-3', name: 'Catupiry', priceDelta: 1.5, active: true, order: 0 },
      { id: 'option-4', name: 'Cheddar', priceDelta: 1.8, active: true, order: 1 },
    ],
  },
];

const tests = [
  {
    name: 'valida seleção obrigatória e soma deltas',
    run() {
      const resolved = resolveModifierSelections(groups, [
        { groupId: 'group-1', optionIds: ['option-2'] },
        { groupId: 'group-2', optionIds: ['option-3', 'option-4'] },
      ]);

      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.equal(resolved.deltaTotal, 5.3);
      assert.equal(formatModifierAwareCartItem({
        productName: 'Esfiha',
        selectedModifiers: resolved.selectedGroups,
      }), 'Esfiha (Escolha o recheio: Carne • Adicionais: Catupiry, Cheddar)');
    },
  },
  {
    name: 'bloqueia grupo obrigatório sem escolha',
    run() {
      const resolved = resolveModifierSelections(groups, []);
      assert.equal(resolved.ok, false);
      if (resolved.ok) return;
      assert.equal(resolved.code, 'group_required');
    },
  },
  {
    name: 'impede configuração impossível no catálogo',
    run() {
      const error = validateModifierGroupDrafts([
        {
          name: 'Escolha o recheio',
          kind: 'variacao',
          minSelections: 2,
          maxSelections: 2,
          active: true,
          order: 0,
          options: [
            { name: 'Frango', priceDelta: 0, active: true, order: 0 },
          ],
        },
      ]);
      assert.match(error ?? '', /pelo menos 2 opções/i);
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
