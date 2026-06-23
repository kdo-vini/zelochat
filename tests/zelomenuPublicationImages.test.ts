import assert from 'node:assert/strict';
import { getOwnedZeloMenuPublicationImagePath } from '../src/domain/zelomenuPublicationImages.js';

const tests = [
  {
    name: 'reconhece path owned do bucket logos',
    run() {
      const path = getOwnedZeloMenuPublicationImagePath(
        'https://example.supabase.co/storage/v1/object/public/logos/zelomenu-products/user-1/42-file.jpg',
      );
      assert.equal(path, 'zelomenu-products/user-1/42-file.jpg');
    },
  },
  {
    name: 'ignora url de outro bucket',
    run() {
      const path = getOwnedZeloMenuPublicationImagePath(
        'https://example.supabase.co/storage/v1/object/public/zelochat-media/zelomenu-products/user-1/42-file.jpg',
      );
      assert.equal(path, null);
    },
  },
  {
    name: 'ignora url externa que nao usa prefixo owned',
    run() {
      const path = getOwnedZeloMenuPublicationImagePath(
        'https://cdn.exemplo.com/uploads/cardapio/file.jpg',
      );
      assert.equal(path, null);
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
