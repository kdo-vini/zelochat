import assert from 'node:assert/strict';
import { normalizeIncomingInteractive } from '../server/whatsappInteractive.js';

assert.deepEqual(normalizeIncomingInteractive({ buttonsResponseMessage: { selectedButtonId: 'REQ:g:o', selectedDisplayText: 'Frango' } }), {
  id: 'REQ:g:o', title: 'Frango', source: 'button',
});
assert.deepEqual(normalizeIncomingInteractive({ listResponseMessage: { singleSelectReply: { selectedRowId: 'REQ:g:o', title: 'Frango' } } }), {
  id: 'REQ:g:o', title: 'Frango', source: 'list',
});
assert.deepEqual(normalizeIncomingInteractive({ templateButtonReplyMessage: { selectedId: 'REQ:g:o', selectedDisplayText: 'Frango' } }), {
  id: 'REQ:g:o', title: 'Frango', source: 'template',
});
assert.deepEqual(normalizeIncomingInteractive({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: JSON.stringify({ selectedRowId: 'REQ:g:o', title: 'Frango' }) } } }), {
  id: 'REQ:g:o', title: 'Frango', source: 'native_flow',
});
assert.equal(normalizeIncomingInteractive({ buttonsResponseMessage: { selectedButtonId: 'x'.repeat(129) } }), null);
assert.equal(normalizeIncomingInteractive({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{not json' } } }), null);
assert.equal(normalizeIncomingInteractive({ buttonsResponseMessage: { selectedButtonId: 'bad\nvalue' } }), null);

console.log('whatsappInteractive tests passed');
