import assert from 'node:assert/strict';
import {
  normalizeZeloMenuSlug,
  isValidZeloMenuSlug,
  isReservedZeloMenuSlug,
  buildPublicStorePath,
  buildPublicStoreUrl,
} from '../src/domain/zelomenuSlug.js';

const tests = [
  {
    name: 'normaliza texto livre para slug seguro (acento, espaço, símbolo)',
    run() {
      assert.equal(normalizeZeloMenuSlug('Casa dos Salgados!!'), 'casa-dos-salgados');
      assert.equal(normalizeZeloMenuSlug('  Açaí & Cia  '), 'acai-cia');
      assert.equal(normalizeZeloMenuSlug('Loja---X'), 'loja-x');
    },
  },
  {
    name: 'rejeita slug curto ou vazio demais',
    run() {
      assert.equal(normalizeZeloMenuSlug('ab'), null);
      assert.equal(normalizeZeloMenuSlug('   '), null);
      assert.equal(normalizeZeloMenuSlug('!!'), null);
    },
  },
  {
    name: 'isValid só aceita slug já canônico',
    run() {
      assert.equal(isValidZeloMenuSlug('casa-dos-salgados'), true);
      assert.equal(isValidZeloMenuSlug('Casa Dos Salgados'), false);
      assert.equal(isValidZeloMenuSlug('casa--x'), false);
    },
  },
  {
    name: 'reserva slugs que colidiriam com rotas',
    run() {
      assert.equal(isReservedZeloMenuSlug('carrinho'), true);
      assert.equal(isReservedZeloMenuSlug('menu'), true);
      assert.equal(isReservedZeloMenuSlug('casa-dos-salgados'), false);
    },
  },
  {
    name: 'monta path e url pública',
    run() {
      assert.equal(buildPublicStorePath('casa-dos-salgados'), '/menu/casa-dos-salgados');
      assert.equal(
        buildPublicStoreUrl('https://menu.zelopdv.com.br/', 'casa-dos-salgados'),
        'https://menu.zelopdv.com.br/casa-dos-salgados',
      );
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
if (failures > 0) process.exit(1);
