import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Live auth smoke (opt-in)', () => {
  test.skip(
    process.env.ZELOCHAT_E2E_LIVE !== '1',
    'Set ZELOCHAT_E2E_LIVE=1 plus ZELOCHAT_E2E_EMAIL/ZELOCHAT_E2E_PASSWORD to run against a real Supabase user.',
  );

  test('test user can log in and reaches app or onboarding', async ({ page }) => {
    const email = process.env.ZELOCHAT_E2E_EMAIL || process.env.E2E_TEST_EMAIL;
    const password = process.env.ZELOCHAT_E2E_PASSWORD || process.env.E2E_TEST_PASSWORD;
    test.skip(!email || !password, 'Missing live E2E credentials.');

    await page.goto('/auth');
    await page.locator('#login-email').fill(email!);
    await page.locator('#login-password').fill(password!);
    await page.getByRole('button', { name: /^Entrar$/ }).click();

    await page.waitForURL(/\/(app|onboarding)/, { timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator('body')).not.toContainText(/TypeError|Cannot read|undefined is not/i);
  });
});
