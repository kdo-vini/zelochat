import { readFileSync } from 'node:fs';
import { assertIncludes, runSuite } from './testHarness.js';

const nginxConf = readFileSync(new URL('../nginx.frontend.conf', import.meta.url), 'utf8');
const bannerSource = readFileSync(
  new URL('../src/components/shared/UpdateAvailableBanner.tsx', import.meta.url),
  'utf8',
);

await runSuite('Update reload/cache guardrails', [
  {
    name: 'SPA shell is not cached by Nginx',
    run: () => {
      assertIncludes(nginxConf, 'location = /index.html', 'index.html has an explicit location');
      assertIncludes(
        nginxConf,
        'Cache-Control "no-store, no-cache, must-revalidate, max-age=0"',
        'index/app routes are served with no-store',
      );
      assertIncludes(nginxConf, 'try_files $uri $uri/ /index.html;', 'SPA fallback still serves index.html');
    },
  },
  {
    name: 'hashed Vite assets stay aggressively cached',
    run: () => {
      assertIncludes(nginxConf, 'location /assets/', 'assets location exists');
      assertIncludes(
        nginxConf,
        'Cache-Control "public, max-age=31536000, immutable"',
        'hashed assets use immutable cache',
      );
    },
  },
  {
    name: 'update cache-bust query is temporary',
    run: () => {
      assertIncludes(bannerSource, "const URL_VERSION_PARAM = 'appVersion';", 'version param is centralized');
      assertIncludes(bannerSource, 'removeRefreshVersionParam();', 'banner removes appVersion after mount');
      assertIncludes(bannerSource, 'window.history.replaceState', 'query cleanup does not reload again');
    },
  },
]);
