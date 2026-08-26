import { expect, test, type Page, type Route } from '@playwright/test';

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

const customers = [
  {
    id: 'person-1', name: 'Ana Souza', phone: '5511999990001', whatsapp: '5511999990001',
    lastActivityAt: '2026-08-25T15:00:00.000Z', activityState: 'active', orderCount: 4,
    totalValue: 186.5, openBalance: null, tags: ['VIP'],
  },
  {
    id: 'person-2', name: 'João Oliveira', phone: null, whatsapp: null,
    lastActivityAt: null, activityState: 'never', orderCount: 0,
    totalValue: 0, openBalance: null, tags: [],
  },
];

const customerDetail = {
  ...customers[0], birthday: { day: 12, month: 4, year: null }, origin: 'WhatsApp',
  notes: 'Prefere pedidos sem cebola.', automaticSummary: 'Cliente frequente da loja.',
  relationship: { blocked: false, blockReason: null, campaigns: 1, automations: 0 },
  orders: [{ id: 'order-1', createdAt: '2026-08-25T15:00:00.000Z', status: 'delivered', total: 56.5 }],
  primaryJid: '5511999990001@s.whatsapp.net', sessions: [],
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installCrmFixture(page: Page, canViewCustomers = true) {
  await page.addInitScript(() => {
    const session = {
      access_token: 'e2e-crm-token', refresh_token: 'e2e-refresh-token', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'user-crm-e2e', aud: 'authenticated', role: 'authenticated', email: 'crm@teste.local',
        app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    };
    // Supabase derives the default storage key from the first hostname label
    // (127 for the local fallback URL), not from host + port.
    localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
  });

  await page.route('**/rest/v1/**', async (route) => {
    const table = new URL(route.request().url()).pathname.split('/').pop();
    if (table === 'empresa_perfil') {
      return json(route, { id: 'empresa-e2e', user_id: 'user-crm-e2e', nome_exibicao: 'Lanchonete Teste',
        zelochat_onboarding_done: true, zelochat_mode: 'restaurant', endereco: null, contato: null,
        logo_url: null, timezone: 'America/Sao_Paulo', documento: null, chave_pix: null,
        manager_phone: null, horario_abertura: null, horario_fechamento: null, dias_fechamento: null,
        horario_semanal: null, ai_instructions: null, blocked_dates: null, manager_history: null,
        delivery_config: null, pix_receipt_config: null, ai_mode: null, ai_schedule_start: null,
        ai_schedule_end: null, ai_schedule_days: null, notify_customer_preparing: true,
        notify_customer_ready: true, notify_customer_out_for_delivery: true, deletion_scheduled_at: null });
    }
    if (table === 'subscriptions') {
      return json(route, { id: 'subscription-e2e', status: 'active', plan_tier: 'chat',
        current_period_end: '2030-01-01T00:00:00.000Z', manually_extended_until: null, cancel_at_period_end: false });
    }
    return json(route, []);
  });

  await page.route('**/auth/v1/**', (route) => json(route, { user: { id: 'user-crm-e2e' } }));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/access/me') {
      return json(route, {
        capabilities: { pessoas: { visualizar: canViewCustomers, gerenciar: false }, clientes: { comunicar: false } },
        rollout: { crm: true },
      });
    }
    if (path === '/api/customers' && route.request().method() === 'GET') {
      return json(route, { customers, total: customers.length, nextCursor: null, hasMore: false });
    }
    if (path === '/api/customers/person-1' && route.request().method() === 'GET') return json(route, customerDetail);
    if (path.endsWith('/messages') && route.request().method() === 'GET') return json(route, { items: [], nextCursor: null, hasMore: false });
    if (path === '/api/sessions') return json(route, { sessions: [], nextCursor: null, hasMore: false });
    if (path === '/api/sessions/tags-map') return json(route, { map: {} });
    if (path === '/api/tags') return json(route, { tags: [] });
    if (path === '/api/escalations/open-count') return json(route, { count: 0 });
    return json(route, { ok: true, sessions: [], data: [] });
  });
}

async function openCustomers(page: Page) {
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Clientes', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Clientes', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ana Souza/ })).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test.describe(`Clientes CRM ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('navega, filtra, abre ficha e mantém acessibilidade sem overflow', async ({ page }) => {
      await installCrmFixture(page);
      await openCustomers(page);

      const width = viewport.width;
      if (width < 768) {
        const nav = page.getByRole('navigation', { name: 'Navegação principal' });
        await expect(nav.getByRole('button')).toHaveText(['Atendimento', 'Clientes', 'Produção', 'Mais']);
        await nav.getByRole('button', { name: 'Mais' }).click();
        const more = page.getByRole('dialog', { name: 'Mais opções' });
        await expect(more).toContainText('Métricas');
        await page.keyboard.press('Escape');
        await expect(more).toBeHidden();
        await expect(nav.getByRole('button', { name: 'Mais' })).toBeFocused();
      } else {
        await expect(page.getByRole('complementary').first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'Clientes', exact: true }).first()).toBeVisible();
      }

      const filters = page.getByRole('button', { name: /^Filtros/ });
      await filters.click();
      const dialog = page.getByRole('dialog', { name: 'Filtros' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Estado')).toBeVisible();
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      if (width < 768) {
        // The sheet anchors to the app content area and intentionally stops
        // above the persistent bottom navigation.
        expect(dialogBox!.y + dialogBox!.height).toBeGreaterThanOrEqual(viewport.height - 100);
      } else {
        expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(width);
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(filters).toBeFocused();

      await page.getByRole('button', { name: /Ana Souza/ }).click();
      await expect(page.getByRole('heading', { name: 'Ana Souza' })).toBeVisible();
      if (width >= 768) {
        await expect(page.getByRole('button', { name: /João Oliveira/ })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: /João Oliveira/ })).toBeHidden();
      }
      await expect(page.getByRole('button', { name: 'Editar cliente' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Excluir cliente' })).toHaveCount(0);
      for (const tab of ['Resumo', 'Mensagens', 'Pedidos', 'Relacionamento']) {
        await page.getByRole('tab', { name: tab }).click();
        await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      }
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page.getByRole('button', { name: /Ana Souza/ })).toBeVisible();

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(width);
    });
  });
}

test.describe('Clientes CRM permissões', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('oculta Clientes quando o ator não tem pessoas.visualizar', async ({ page }) => {
    await installCrmFixture(page, false);
    await page.goto('/app');
    await expect(page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Clientes' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clientes', exact: true })).toHaveCount(0);
  });
});
