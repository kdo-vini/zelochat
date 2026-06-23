import assert from 'node:assert/strict';
import {
  getZeloMenuPublicationStatus,
  summarizeZeloMenuPublication,
  type ZeloMenuPublicationProduct,
} from '../src/domain/zelomenuPublication.js';

const base: ZeloMenuPublicationProduct = {
  id: 1,
  nome: 'Coxinha',
  id_categoria: 10,
  controlar_estoque: false,
  estoque_atual: 0,
  ocultar_no_pdv: false,
};

const tests = [
  {
    name: 'produto ativo com categoria fica pronto para o link',
    run() {
      const status = getZeloMenuPublicationStatus(base);
      assert.equal(status.status, 'published');
      assert.equal(status.issue, null);
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
    name: 'resumo conta prontos e pontos de atenção',
    run() {
      const summary = summarizeZeloMenuPublication([
        base,
        { ...base, id: 2, ocultar_no_pdv: true },
        { ...base, id: 3, controlar_estoque: true, estoque_atual: 0 },
        { ...base, id: 4, id_categoria: null },
      ]);
      assert.deepEqual(summary, {
        total: 4,
        published: 1,
        hidden: 1,
        outOfStock: 1,
        missingCategory: 1,
        attention: 3,
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
