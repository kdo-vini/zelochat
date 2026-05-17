import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const shouldStartFrontend = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    headless: true,
    locale: 'pt-BR',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: shouldStartFrontend
    ? {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      }
    : undefined,
});
