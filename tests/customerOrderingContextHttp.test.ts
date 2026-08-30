import assert from 'node:assert/strict';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { AccessControlError, type ActorAccessContext } from '../server/accessControl.js';
import { OrderingOverridesValidationError } from '../server/customers/orderingContext.js';
import { createCustomerOrderingContextRouter } from '../server/customers/orderingContextRouter.js';

const manager: ActorAccessContext = {
  actorUserId: 'manager-1', ownerUserId: 'owner-1', empresaId: 'empresa-1',
  isOwner: false, permissions: { 'pessoas.gerenciar': true },
};

async function withServer(app: Express, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server address unavailable');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

{
  let received: unknown = null;
  const app = express();
  app.use(express.json());
  app.use('/api/customers', createCustomerOrderingContextRouter({
    resolveManageAccess: async () => manager,
    context: {
      patchOverrides: async (input) => {
        received = input;
        return { paymentMethod: { value: 'Pix', source: 'fixed' }, overrides: { paymentMethod: 'Pix' } } as never;
      },
    },
  }));
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/customers/person-1/ordering-overrides`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentMethod: 'Pix', habitualTime: null }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, {
      empresaId: 'empresa-1', pessoaId: 'person-1', ownerUserId: 'owner-1',
      patch: { paymentMethod: 'Pix', habitualTime: null },
    });
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(body.overrides, { paymentMethod: 'Pix' });
  });
}

for (const scenario of [
  {
    name: 'viewer',
    error: new AccessControlError('FORBIDDEN'),
    status: 403,
    message: 'Você não tem permissão para alterar os hábitos de pedido.',
  },
  {
    name: 'invalid payload',
    error: new OrderingOverridesValidationError('Escolha entrega ou retirada.'),
    status: 400,
    message: 'Escolha entrega ou retirada.',
  },
  {
    name: 'foreign customer',
    error: new Error('CUSTOMER_NOT_FOUND'),
    status: 404,
    message: 'Cliente não encontrado.',
  },
]) {
  const app = express();
  app.use(express.json());
  app.use('/api/customers', createCustomerOrderingContextRouter({
    resolveManageAccess: async () => {
      if (scenario.name === 'viewer') throw scenario.error;
      return manager;
    },
    context: { patchOverrides: async () => { throw scenario.error; } },
  }));
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/customers/person-1/ordering-overrides`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fulfillmentType: 'delivery' }),
    });
    assert.equal(response.status, scenario.status, scenario.name);
    const body = await response.json() as { message: string };
    assert.equal(body.message, scenario.message, scenario.name);
    assert.doesNotMatch(body.message, /Supabase|endpoint|upstream|webhook/iu);
  });
}

console.log('customerOrderingContextHttp: ok');
