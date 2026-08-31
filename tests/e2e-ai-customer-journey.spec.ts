import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { loadCustomerJourneyConfig } from './support/customerJourney.js';

type JsonObject = Record<string, any>;

const config = loadCustomerJourneyConfig();
const skipReason = 'reason' in config ? config.reason : '';
test.skip(!config.enabled, skipReason);
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function loginAndReadAccessToken(page: Page, email: string, password: string): Promise<string> {
  await page.route('**/api/**', (route) => route.abort('blockedbyclient'));
  await page.goto('/auth');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('form').getByRole('button', { name: /^Entrar$/ }).click();
  await page.waitForFunction(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const raw = localStorage.getItem(localStorage.key(index) ?? '');
      if (!raw) continue;
      try {
        if (typeof JSON.parse(raw).access_token === 'string') return true;
      } catch {
        // Ignore unrelated browser state.
      }
    }
    return false;
  }, undefined, { timeout: 20_000 });

  const token = await page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const raw = localStorage.getItem(localStorage.key(index) ?? '');
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { access_token?: unknown };
        if (typeof parsed.access_token === 'string') return parsed.access_token;
      } catch {
        // Ignore unrelated browser state.
      }
    }
    return null;
  });
  expect(token, 'login must persist a Supabase access token').toBeTruthy();
  return token!;
}

async function json(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<JsonObject> {
  const body = await response.json().catch(() => ({}));
  const safeUrl = response.url().replace(/(\/public-api\/zelomenu\/cart\/)[^/?#]+/u, '$1[redacted]');
  expect(response.ok(), `${safeUrl} -> ${response.status()} ${JSON.stringify(body)}`).toBe(true);
  return body as JsonObject;
}

async function sessionFor(api: APIRequestContext, jid: string): Promise<JsonObject | null> {
  const response = await api.get(`/api/sessions/${encodeURIComponent(jid)}`);
  if (response.status() === 404) return null;
  const body = await json(response);
  return (body.session ?? body) as JsonObject;
}

function supabaseProjectRefFromJwt(token: string): string {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('JWT E2E inválido.');
  const issuer = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).iss;
  if (typeof issuer !== 'string') throw new Error('JWT E2E sem issuer.');
  return new URL(issuer).hostname.split('.')[0] ?? '';
}

function firstOrderableProduct(catalog: JsonObject[]): {
  productName: string;
  modifierSelections: Array<{ groupName: string; optionNames: string[] }>;
  hasModifiers: boolean;
  unitBased: boolean;
} {
  const products = catalog.flatMap((category) => [
    ...(Array.isArray(category.produtosDireto) ? category.produtosDireto : []),
    ...(Array.isArray(category.subcategorias)
      ? category.subcategorias.flatMap((subcategory: JsonObject) => subcategory.produtos ?? [])
      : []),
  ]).filter((product) => product.available === true && Number.isSafeInteger(product.id));

  for (const product of products) {
    const modifierSelections: Array<{ groupName: string; optionNames: string[] }> = [];
    let valid = true;
    for (const group of product.modifierGroups ?? []) {
      const minimum = Math.max(0, Number(group.minSelections ?? 0));
      const activeOptions = (group.options ?? []).filter((option: JsonObject) => option.active !== false);
      if (activeOptions.length < minimum) {
        valid = false;
        break;
      }
      if (minimum > 0) {
        const chosen = activeOptions.slice(0, minimum);
        modifierSelections.push({
          groupName: String(group.name),
          optionNames: chosen.map((option: JsonObject) => String(option.name)),
        });
      }
    }
    if (valid) return {
      productName: product.name,
      modifierSelections,
      hasModifiers: (product.modifierGroups ?? []).length > 0,
      unitBased: product.unitBased === true,
    };
  }
  throw new Error('A conta E2E precisa ter ao menos um produto publicado e comprável.');
}

function canonicalBrazilPhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/gu, '');
  return digits.startsWith('55') && (digits.length === 12 || digits.length === 13) ? digits.slice(2) : digits;
}

test.describe('Jornada completa IA → cardápio → pedido → CRM', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('cliente novo recebe cardápio, faz pedido, entra no CRM e recebe atualização', async ({ page }) => {
    test.skip(!config.enabled, 'Configuração E2E incompleta.');
    if (!config.enabled) return;

    const marker = `E2E-${Date.now()}`;
    const accessToken = await loginAndReadAccessToken(page, config.email, config.password);
    expect(
      supabaseProjectRefFromJwt(accessToken),
      'o login precisa pertencer exatamente ao projeto Supabase descartável declarado',
    ).toBe(config.expectedSupabaseRef);
    const api = await request.newContext({
      baseURL: config.apiUrl,
      extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
    });
    const webhook = await request.newContext({
      baseURL: config.apiUrl,
      extraHTTPHeaders: { 'x-webhook-token': config.webhookToken },
    });
    let personId: string | null = null;
    let orderId: string | null = null;
    let orderRevision: number | null = null;
    let journeyWritesStarted = false;

    try {
      const binding = await json(await api.post('/api/bind-empresa'));
      expect(
        binding.empresaId,
        'o usuário precisa resolver exatamente para o tenant descartável declarado',
      ).toBe(config.expectedEmpresaId);
      await page.unroute('**/api/**');
      await page.goto('/app');

      const status = await json(await api.get('/api/status'));
      expect(status.status, 'a instância E2E precisa estar conectada').toBe('connected');
      expect((await json(await api.get('/api/ai-enabled'))).enabled, 'a IA precisa estar ligada').toBe(true);

      const before = await json(await api.get(`/api/customers?q=${encodeURIComponent(config.customerPhone)}&limit=10`));
      expect(
        (before.customers ?? []).filter((customer: JsonObject) => canonicalBrazilPhone(customer.phone) === config.customerPhone),
        'o número dedicado deve começar sem cadastro para provar a criação automática',
      ).toHaveLength(0);

      journeyWritesStarted = true;
      const inbound = await webhook.post(`/webhook/${encodeURIComponent(config.instance)}`, {
          data: {
            event: 'messages.upsert',
            data: {
              key: { remoteJid: config.jid, fromMe: false, id: `CUSTOMER_JOURNEY_${marker}` },
              pushName: `Cliente ${marker}`,
              messageTimestamp: Math.floor(Date.now() / 1000),
              message: { conversation: `Olá, quero fazer um pedido. Pode me enviar o cardápio? ${marker}` },
            },
          },
        });
      expect(inbound.status()).toBe(200);

      let session: JsonObject | null = null;
      await expect.poll(async () => {
        session = await sessionFor(api, config.jid);
        return session?.personId ?? null;
      }, { timeout: 45_000, message: 'webhook deve criar e vincular o cliente no CRM' }).not.toBeNull();
      personId = session!.personId;

      const slugBody = await json(await api.get('/api/zelomenu/slug'));
      expect(slugBody.slug, 'a conta E2E precisa ter um slug público').toBeTruthy();
      expect(slugBody.publicUrl, 'o backend deve informar a URL pública da loja').toBeTruthy();
      const expectedMenuUrl = String(slugBody.publicUrl);
      await expect.poll(async () => {
        const current = await sessionFor(api, config.jid);
        const reply = (current?.messages ?? [])
          .filter((message: JsonObject) => message.role === 'assistant')
          .find((message: JsonObject) => String(message.content ?? message.preview ?? '').includes(expectedMenuUrl));
        return reply ? { text: String(reply.content ?? reply.preview ?? ''), status: reply.status ?? null } : null;
      }, { timeout: 90_000, message: 'IA deve entregar o cardápio pelo provedor real' }).toMatchObject({
        text: expect.stringContaining(expectedMenuUrl),
        status: 'sent',
      });

      const store = await json(await webhook.get(`/public-api/zelomenu/store/${encodeURIComponent(slugBody.slug)}`));
      const product = firstOrderableProduct(store.catalog ?? []);
      expect(store.business?.businessHours?.openNow, 'a conta E2E deve ficar aberta durante o teste').not.toBe(false);
      await page.goto(expectedMenuUrl);
      await expect(
        page.getByText(product.productName, { exact: false }).first(),
        'o link enviado pela IA deve abrir o cardápio real e exibir o produto usado no pedido',
      ).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: `Adicionar ${product.productName}`, exact: true }).first().click();
      for (const selection of product.modifierSelections) {
        const group = page.locator('section').filter({
          has: page.getByText(selection.groupName, { exact: true }),
        }).last();
        for (const optionName of selection.optionNames) {
          await group.getByText(optionName, { exact: true }).click();
        }
      }
      if (product.hasModifiers || product.unitBased) {
        await page.getByRole('button', { name: 'Adicionar', exact: true }).last().click();
      }
      await page.getByRole('button', { name: 'Continuar pedido', exact: true }).click();
      await page.waitForURL(/\/menu\/carrinho\/[^/?#]+/u, { timeout: 20_000 });
      const cartToken = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
      expect(cartToken, 'a interface pública deve criar um carrinho com token').toBeTruthy();

      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await page.getByPlaceholder('Como te chamamos').fill(`Cliente ${marker}`);
      await page.getByPlaceholder('(XX) XXXXX-XXXX').fill(config.customerPhone);
      await page.getByRole('button', { name: 'Retirada', exact: true }).click();
      await page.getByRole('button', { name: 'Pra já', exact: true }).click();
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await page.getByRole('button', { name: 'Dinheiro', exact: true }).click();
      await page.getByRole('button', { name: 'Confirmar pedido', exact: true }).click();

      let publicCart: JsonObject | null = null;
      await expect.poll(async () => {
        publicCart = await json(await webhook.get(`/public-api/zelomenu/cart/${encodeURIComponent(cartToken!)}`));
        return publicCart.productionOrder ?? null;
      }, { timeout: 30_000, message: 'confirmação pública deve materializar o pedido canônico' }).not.toBeNull();
      orderId = publicCart!.productionOrder.id;
      orderRevision = Number(publicCart!.productionOrder.revision);

      const customer = await json(await api.get(`/api/customers/${encodeURIComponent(personId!)}`));
      expect(customer.primaryJid).toBe(config.jid);
      expect(customer.orders.some((order: JsonObject) => order.id === orderId)).toBe(true);

      if (publicCart!.productionOrder.status === 'pending_review') {
        const accepted = await json(await api.patch(`/api/orders/${encodeURIComponent(orderId!)}/status`, {
          data: { status: 'pending', expectedRevision: orderRevision },
        }));
        orderRevision = Number(accepted.order.revision);
      }
      const messagesBeforeTransition = new Set(
        ((await sessionFor(api, config.jid))?.messages ?? []).map((message: JsonObject) => message.id),
      );
      const preparing = await json(await api.patch(`/api/orders/${encodeURIComponent(orderId!)}/status`, {
        data: { status: 'preparing', expectedRevision: orderRevision },
      }));
      orderRevision = Number(preparing.order.revision);

      await expect.poll(async () => {
        publicCart = await json(await webhook.get(`/public-api/zelomenu/cart/${encodeURIComponent(cartToken!)}`));
        return publicCart.productionOrder?.status;
      }, { timeout: 20_000 }).toBe('preparing');

      await expect.poll(async () => {
        const current = await sessionFor(api, config.jid);
        const notification = (current?.messages ?? [])
          .filter((message: JsonObject) => message.role === 'assistant')
          .find((message: JsonObject) => {
            return /preparando/iu.test(String(message.content ?? message.preview ?? ''))
              && !messagesBeforeTransition.has(message.id);
          });
        return notification ? {
          text: String(notification.content ?? notification.preview ?? ''),
          status: notification.status ?? null,
          origin: notification.outboundOrigin ?? notification.outbound_origin ?? null,
        } : null;
      }, { timeout: 45_000, message: 'mudança de status deve chegar ao cliente pelo provedor real' }).toMatchObject({
        text: expect.stringMatching(/preparando/iu),
        status: 'sent',
        origin: 'system_transactional',
      });

      await page.goto('/app');
      await page.getByRole('button', { name: 'Clientes', exact: true }).first().click();
      await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
      await page.getByPlaceholder('Buscar clientes').fill(config.customerPhone);
      await page.getByRole('button', { name: new RegExp(`Cliente ${marker}`, 'u') }).click();
      await expect(page.getByRole('heading', { name: `Cliente ${marker}` })).toBeVisible();
      await page.getByRole('tab', { name: 'Mensagens' }).click();
      await expect(page.getByText(marker, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(expectedMenuUrl, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(/preparando/iu).first()).toBeVisible();
      await page.getByRole('tab', { name: 'Pedidos' }).click();
      await expect(page.getByText(/preparing/u).first()).toBeVisible();
    } finally {
      if (orderId && Number.isSafeInteger(orderRevision)) {
        await api.delete(`/api/orders/${encodeURIComponent(orderId)}`, { data: { expectedRevision: orderRevision } }).catch(() => undefined);
      }
      if (journeyWritesStarted) {
        await api.delete(`/api/sessions/${encodeURIComponent(config.jid)}`).catch(() => undefined);
        if (personId) await api.delete(`/api/customers/${encodeURIComponent(personId)}`).catch(() => undefined);
      }
      await api.dispose();
      await webhook.dispose();
    }
  });
});
