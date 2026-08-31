import assert from 'node:assert/strict';

const connectionModule = await import('../src/domain/whatsappConnection.js').catch(() => null);

assert.notEqual(
  connectionModule,
  null,
  'the app needs a shared resolver for the authenticated WhatsApp connection status',
);

if (connectionModule) {
  const { toWhatsAppConnectivity } = connectionModule;
  assert.equal(toWhatsAppConnectivity('connected'), true, 'a connected provider status keeps the global alert hidden');
  assert.equal(toWhatsAppConnectivity('qr'), false, 'a QR waiting to be scanned shows the global reconnect alert');
  assert.equal(toWhatsAppConnectivity('connecting'), false, 'a pairing that is still connecting shows the global reconnect alert');
  assert.equal(toWhatsAppConnectivity('disconnected'), false, 'a disconnected provider status shows the global reconnect alert');
  assert.equal(toWhatsAppConnectivity('unexpected'), null, 'an unknown response does not overwrite the last known connectivity');
}

console.log('PASS WhatsApp connection status is safe for the global alert');
