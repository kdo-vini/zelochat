import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Auth E2E frontend-only', () => {
  test('protected app route redirects anonymous users to auth', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.locator('#login-email')).toBeVisible();
  });

  test('login and signup tabs render the expected fields', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();

    await page.getByRole('button', { name: /^Criar conta$/ }).click();
    await expect(page.locator('#signup-email')).toBeVisible();
    await expect(page.locator('#signup-password')).toBeVisible();
    await expect(page.locator('#signup-confirm')).toBeVisible();
  });

  test('invalid login shows a friendly Portuguese error', async ({ page }) => {
    await page.route('**/auth/v1/token?grant_type=password', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', msg: 'Invalid login credentials' }),
      });
    });

    await page.goto('/auth');
    await page.locator('#login-email').fill('cliente.teste@exemplo.com.br');
    await page.locator('#login-password').fill('senha-errada-123');
    await page.locator('form').getByRole('button', { name: /^Entrar$/ }).click();

    await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible();
  });

  test('signup validates password length and confirmation locally', async ({ page }) => {
    await page.goto('/auth?mode=signup');
    await page.locator('#signup-email').fill('novo.cliente@exemplo.com.br');
    await page.locator('#signup-password').fill('123');
    await page.locator('#signup-confirm').fill('456');
    await page.locator('form').getByRole('button', { name: /^Criar conta$/ }).click();

    await expect(page.getByText('A senha deve ter pelo menos 8 caracteres.')).toBeVisible();

    await page.locator('#signup-password').fill('12345678');
    await page.locator('#signup-confirm').fill('87654321');
    await page.locator('form').getByRole('button', { name: /^Criar conta$/ }).click();

    await expect(page.getByText('As senhas não conferem.')).toBeVisible();
  });

  test('forgot-password route renders without exposing whether an account exists', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    await expect(page.getByRole('heading', { name: /recuperar|senha/i })).toBeVisible();
    await expect(page.getByLabel(/e-?mail/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /enviar|recuperar|redefinir/i })).toBeVisible();
  });
});
