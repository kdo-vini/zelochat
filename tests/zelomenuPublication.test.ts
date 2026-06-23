import assert from 'node:assert/strict';
import {
  getZeloMenuPublicationStatus,
  resolveZeloMenuPublicationCatalogProduct,
  summarizeZeloMenuPublication,
  type ZeloMenuPublicationProduct,
} from '../src/domain/zelomenuPublication.js';
import type { ZeloMenuModifierGroup } from '../src/domain/zelomenuModifiers.js';

const base: ZeloMenuPublicationProduct = {
  id: 1,
  nome: 'Coxinha',
  id_categoria: 10,
  controlar_estoque: false,
  estoque_atual: 0,
  ocultar_no_pdv: false,
  publication: {
    id_produto: 1,
    nome_publico: null,
    descricao_publica: null,
    foto_url: null,
    visivel_online: true,
    pausado_manualmente: false,
    ordem: 0,
  },
  modifierGroups: [],
};

const baseModifierGroups: ZeloMenuModifierGroup[] = [
  {
    id: 'group-1',
    productId: 1,
    name: 'Molhos',
    kind: 'adicional',
    minSelections: 0,
    maxSelections: 2,
    active: true,
    order: 1,
    options: [
      { id: 'option-1', name: 'Ketchup', priceDelta: 0, active: true, order: 1 },
      { id: 'option-2', name: 'Maionese verde', priceDelta: 1.5, active: true, order: 2 },
    ],
  },
];

const tests = [
  {
    name: 'produto ativo com categoria e publicação ligada aparece no link',
    run() {
      const status = getZeloMenuPublicationStatus(base);
      assert.equal(status.status, 'published');
      assert.equal(status.issue, null);
    },
  },
  {
    name: 'produto sem overlay publicado fica fora do link',
    run() {
      const status = getZeloMenuPublicationStatus({ ...base, publication: null });
      assert.equal(status.status, 'unpublished');
      assert.equal(status.issue, 'unpublished');
    },
  },
  {
    name: 'produto pausado no ZeloMenu vence bloqueios do catálogo base',
    run() {
      const status = getZeloMenuPublicationStatus({
        ...base,
        ocultar_no_pdv: true,
        publication: { ...base.publication!, pausado_manualmente: true },
      });
      assert.equal(status.status, 'paused');
      assert.equal(status.issue, 'paused');
    },
  },
  {
    name: 'produto oculto vence outros estados',
    run() {
      const status = getZeloMenuPublicationStatus({
        ...base,
        ocultar_no_pdv: true,
        controlar_estoque: true,
        estoque_atual: 0,
        id_categoria: null,
        publication: { ...base.publication!, visivel_online: true, pausado_manualmente: false },
      });
      assert.equal(status.status, 'hidden');
      assert.equal(status.issue, 'hidden');
    },
  },
  {
    name: 'estoque controlado zerado bloqueia publicação',
    run() {
      const status = getZeloMenuPublicationStatus({
        ...base,
        controlar_estoque: true,
        estoque_atual: 0,
      });
      assert.equal(status.status, 'out_of_stock');
      assert.match(status.description, /estoque/i);
    },
  },
  {
    name: 'produto sem categoria pede organização',
    run() {
      const status = getZeloMenuPublicationStatus({ ...base, id_categoria: null });
      assert.equal(status.status, 'missing_category');
      assert.match(status.description, /categoria/i);
    },
  },
  {
    name: 'produto publicado usa apresentação pública sem duplicar preço base',
    run() {
      const resolved = resolveZeloMenuPublicationCatalogProduct({
        ...base,
        name: base.nome,
        price: 7.5,
        unitBased: true,
        stockControlled: true,
        stockQuantity: 12,
        modifierGroups: baseModifierGroups,
        publication: {
          id_produto: 1,
          nome_publico: 'Coxinha especial',
          descricao_publica: 'Massa crocante com recheio cremoso.',
          foto_url: 'https://cdn.exemplo.com/coxinha.jpg',
          visivel_online: true,
          pausado_manualmente: false,
          ordem: 4,
        },
      });

      assert.deepEqual(resolved, {
        id: 1,
        name: 'Coxinha especial',
        price: 7.5,
        basePrice: 7.5,
        available: true,
        description: 'Massa crocante com recheio cremoso.',
        photoUrl: 'https://cdn.exemplo.com/coxinha.jpg',
        sortOrder: 4,
        unitBased: true,
        stockControlled: true,
        stockQuantity: 12,
        modifierGroups: baseModifierGroups,
      });
    },
  },
  {
    name: 'produto sem publicação não fica disponível no catálogo público',
    run() {
      const resolved = resolveZeloMenuPublicationCatalogProduct({
        ...base,
        name: base.nome,
        price: 7.5,
        publication: null,
      });

      assert.equal(resolved.name, 'Coxinha');
      assert.equal(resolved.available, false);
    },
  },
  {
    name: 'pausa manual mantém dados públicos mas tira o item do link',
    run() {
      const resolved = resolveZeloMenuPublicationCatalogProduct({
        ...base,
        name: base.nome,
        price: 7.5,
        publication: {
          ...base.publication!,
          nome_publico: 'Coxinha especial',
          pausado_manualmente: true,
        },
      });

      assert.equal(resolved.name, 'Coxinha especial');
      assert.equal(resolved.available, false);
    },
  },
  {
    name: 'resumo conta prontos e pontos de atenção',
    run() {
      const summary = summarizeZeloMenuPublication([
        base,
        { ...base, id: 2, publication: null },
        { ...base, id: 3, publication: { ...base.publication!, pausado_manualmente: true } },
        { ...base, id: 4, ocultar_no_pdv: true },
        { ...base, id: 5, controlar_estoque: true, estoque_atual: 0 },
        { ...base, id: 6, id_categoria: null },
      ]);
      assert.deepEqual(summary, {
        total: 6,
        published: 1,
        unpublished: 1,
        paused: 1,
        hidden: 1,
        outOfStock: 1,
        missingCategory: 1,
        attention: 5,
      });
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
