import { inspectDeployment, waitForDeployment } from './verify-deployment.mjs';

// Run inside the backend container sharing the frontend's --network none
// namespace. Only loopback is reachable; neither image receives real credentials.
const fetchImages = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== '127.0.0.1') throw new Error('Image smoke permits loopback only');
  url.port = url.pathname === '/api/version' ? '3001' : '80';
  return fetch(url, options);
};

await waitForDeployment({
  baseUrl: 'http://127.0.0.1', expectedSha: process.env.GITHUB_SHA,
  timeoutMs: 60_000, pollMs: 1_000,
  inspect: options => inspectDeployment({ ...options, fetchImpl: fetchImages }),
  log: message => console.log(`[isolated image HTTP] ${message}`),
});
