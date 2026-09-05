import { pathToFileURL } from 'node:url';

const READ_TIMEOUT_MS = 5_000;
const DEPLOY_TIMEOUT_MS = 12 * 60_000;
const MAX_ASSETS = 128;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

async function readPublic(url, deadline, fetchImpl, limit = MAX_ASSET_BYTES) {
  let phase = 'request';
  try {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Deployment verification deadline exceeded');
    const response = await fetchImpl(url, {
      method: 'GET', signal: AbortSignal.timeout(Math.min(READ_TIMEOUT_MS, remaining)),
      redirect: 'error', headers: { 'cache-control': 'no-cache' },
    });
    phase = 'headers';
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    phase = 'body';
    let bytes = 0;
    const chunks = [];
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) throw new Error('response exceeds byte limit');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return { text: Buffer.concat(chunks).toString('utf8'), type: response.headers.get('content-type') || '', bytes };
  } catch (error) {
    const code = error.cause?.code || error.code;
    throw new Error(`${url.hostname}${url.pathname} [${phase}]: ${error.message}${code ? ` (${code})` : ''}`, { cause: error });
  }
}

function localAsset(reference, parent, origin) {
  const url = new URL(reference.startsWith('assets/') ? `/${reference}` : reference, parent);
  return url.origin === origin && url.pathname.startsWith('/assets/') ? url : null;
}

/** Read public release evidence only: no auth, DB, providers or business writes. */
export async function inspectDeployment({ baseUrl, expectedSha, deadline = Date.now() + DEPLOY_TIMEOUT_MS, fetchImpl = fetch }) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha || '')) throw new Error('Expected a complete 40-character Git SHA');
  const base = new URL(baseUrl);
  const fresh = path => {
    const url = new URL(path, base);
    url.searchParams.set('verify', `${expectedSha}-${Date.now()}`);
    return url;
  };
  const short = expectedSha.slice(0, 12);
  for (const path of ['/build-info.json', '/api/version']) {
    const result = await readPublic(fresh(path), deadline, fetchImpl, 16 * 1024);
    const metadata = JSON.parse(result.text);
    if (metadata.sourceCommit !== expectedSha || metadata.version !== short) {
      throw new Error(`${path}: expected ${expectedSha}, received ${metadata.sourceCommit || 'missing SHA'} / ${metadata.version || 'missing version'}`);
    }
  }
  const html = await readPublic(fresh('/'), deadline, fetchImpl, 1024 * 1024);
  if (!html.type.includes('text/html')) throw new Error('Root response is not HTML');
  const queue = [];
  for (const match of html.text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const asset = localAsset(match[1], base, base.origin);
    if (asset) queue.push(asset);
  }
  if (!queue.some(url => url.pathname.endsWith('.js'))) throw new Error('HTML references no local JavaScript entry');
  const seen = new Set();
  let versionFound = false;
  let totalBytes = 0;
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    if (seen.size > MAX_ASSETS) throw new Error('Asset graph exceeds verification limit');
    const asset = await readPublic(url, deadline, fetchImpl);
    totalBytes += asset.bytes;
    if (totalBytes > 64 * 1024 * 1024) throw new Error('Asset graph exceeds byte limit');
    const isJs = url.pathname.endsWith('.js');
    if (isJs && !/(?:javascript|ecmascript)/i.test(asset.type)) throw new Error(`${url.pathname}: JavaScript content type missing`);
    if (url.pathname.endsWith('.css') && !asset.type.includes('text/css')) throw new Error(`${url.pathname}: CSS content type missing`);
    if (!isJs) continue;
    if (asset.text.includes(short)) versionFound = true;
    // Vite preload tables and dynamic imports include hashed relative filenames.
    // Follow them as well: AppShell (and the build version) is loaded lazily.
    for (const match of asset.text.matchAll(/["']((?:\/?assets\/|\.\/?|\.\.\/)?[^"'\\\s<>]+-[\w-]{8,}\.(?:js|css)(?:[?#][^"'\\\s<>]*)?)["']/g)) {
      const dependency = localAsset(match[1], url, base.origin);
      if (dependency) queue.push(dependency);
    }
  }
  if (!versionFound) throw new Error(`Referenced JavaScript does not contain baked version ${short}`);
  return { sourceCommit: expectedSha, version: short, assets: seen.size, bytes: totalBytes };
}

export async function waitForDeployment({ baseUrl, expectedSha, timeoutMs = DEPLOY_TIMEOUT_MS, pollMs = 10_000,
  inspect = inspectDeployment, log = console.log }) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha || '')) throw new Error('Expected a complete 40-character Git SHA');
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const result = await inspect({ baseUrl, expectedSha, deadline });
      log(`Production verified: ${result.sourceCommit}; ${result.assets} assets; ${result.bytes} bytes`);
      return result;
    } catch (error) {
      lastError = error;
      log(`Awaiting production (attempt ${attempt}): ${error.message}`);
      const remaining = deadline - Date.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, remaining)));
    }
  }
  throw new Error(`Production did not converge to ${expectedSha} within ${timeoutMs / 1000}s. Last check: ${lastError?.message || 'no attempt'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await waitForDeployment({ baseUrl: 'https://chat.zelopdv.com.br', expectedSha: process.env.GITHUB_SHA });
}
