import assert from 'node:assert/strict';
import axios from 'axios';

process.env.WHATSMIAU_BASE_URL = 'https://whatsmiau.test';
const previousAdapter = axios.defaults.adapter;
axios.defaults.adapter = async () => {
  throw new Error('temporary provider failure');
};

try {
  const { fetchInstanceConnectionState } = await import('../server/whatsapp.js');
  assert.equal(
    await fetchInstanceConnectionState('status-failure-regression'),
    'unknown',
    'a failed provider status query must not be reported as a real WhatsApp disconnect',
  );
  console.log('PASS provider status failures remain unknown to the global alert');
} finally {
  axios.defaults.adapter = previousAdapter;
}
