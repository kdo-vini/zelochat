import { Router, type Request, type Response } from 'express';
import { AccessControlError, requireActorPermission, type ActorAccessContext } from '../accessControl.js';
import type { CustomerOrderingContextSnapshot } from '../../src/types.js';
import { requireCrmFeature } from './rollout.js';
import { isOrderingOverridesValidationError } from './orderingContext.js';
import { CustomerOrderingContext } from './orderingContextAdapter.js';

export interface CustomerOrderingContextApi {
  patchOverrides(input: {
    empresaId: string;
    pessoaId: string;
    ownerUserId: string;
    patch: unknown;
  }): Promise<CustomerOrderingContextSnapshot>;
}

export interface CustomerOrderingContextRouterDependencies {
  resolveManageAccess: (req: Request) => Promise<ActorAccessContext>;
  context: CustomerOrderingContextApi;
}

const defaultDependencies: CustomerOrderingContextRouterDependencies = {
  async resolveManageAccess(req) {
    await requireCrmFeature(req, 'crm');
    return requireActorPermission(req, 'pessoas.gerenciar');
  },
  context: CustomerOrderingContext,
};

function sendOrderingContextError(res: Response, error: unknown): void {
  if (error instanceof AccessControlError) {
    const status = error.code === 'FORBIDDEN' ? 403 : 401;
    res.status(status).json({
      code: error.code,
      message: error.code === 'FORBIDDEN'
        ? 'Você não tem permissão para alterar os hábitos de pedido.'
        : 'Entre novamente para alterar os hábitos de pedido.',
    });
    return;
  }
  if (isOrderingOverridesValidationError(error)) {
    res.status(400).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND') {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Cliente não encontrado.' });
    return;
  }
  console.error('[customers] ordering overrides update failed:', error);
  res.status(500).json({
    code: 'CUSTOMER_ORDERING_UPDATE_FAILED',
    message: 'Não foi possível salvar os hábitos de pedido. Tente novamente.',
  });
}

export function createCustomerOrderingContextRouter(
  dependencies: CustomerOrderingContextRouterDependencies = defaultDependencies,
): Router {
  const router = Router();
  router.patch('/:personId/ordering-overrides', async (req, res) => {
    try {
      const access = await dependencies.resolveManageAccess(req);
      const snapshot = await dependencies.context.patchOverrides({
        empresaId: access.empresaId,
        pessoaId: req.params.personId,
        ownerUserId: access.ownerUserId,
        patch: req.body,
      });
      res.json(snapshot);
    } catch (error) {
      sendOrderingContextError(res, error);
    }
  });
  return router;
}
