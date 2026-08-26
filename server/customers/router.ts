import { Router, type Request, type Response } from 'express';
import {
  createCustomer,
  deleteCustomerWithPdvRpc,
  executeCustomerMerge,
  mapCustomerMutationError,
  previewCustomerMerge,
  updateCustomer,
  type CustomerMergeRequest,
  type CustomerMutationAccess,
  type CustomerWriteStore,
} from './mutations.js';

export interface CustomerRouterDependencies {
  resolveAccess: (req: Request) => Promise<CustomerMutationAccess>;
  store: CustomerWriteStore;
}

function sendError(res: Response, cause: unknown): void {
  const mapped = mapCustomerMutationError({ code: cause instanceof Error ? cause.message : null });
  const status = mapped.code === 'FORBIDDEN' ? 403 : mapped.code === 'NOT_FOUND' ? 404 : mapped.code === 'CUSTOMER_OPEN_BALANCE' ? 409 : 400;
  res.status(status).json(mapped);
}

/** CRM writes are isolated here so every handler resolves actor, tenant and RBAC before service-role access. */
export function createCustomersRouter(deps: CustomerRouterDependencies): Router {
  const router = Router();
  router.post('/', async (req, res) => { try { const access = await deps.resolveAccess(req); const customer = await createCustomer(access, req.body ?? {}, deps.store); res.status(201).json(customer); } catch (cause) { sendError(res, cause); } });
  router.patch('/:personId', async (req, res) => { try { const access = await deps.resolveAccess(req); const customer = await updateCustomer(access, req.params.personId, req.body ?? {}, deps.store); res.json(customer); } catch (cause) { sendError(res, cause); } });
  router.delete('/:personId', async (req, res) => { try { const access = await deps.resolveAccess(req); await deleteCustomerWithPdvRpc(access, req.params.personId, deps.store); res.status(204).end(); } catch (cause) { sendError(res, cause); } });
  router.post('/merge/preview', async (req, res) => { try { const access = await deps.resolveAccess(req); const request = req.body as CustomerMergeRequest; const preview = await previewCustomerMerge(access, request, deps.store); res.json(preview); } catch (cause) { sendError(res, cause); } });
  router.post('/merge', async (req, res) => { try { const access = await deps.resolveAccess(req); const request = req.body as CustomerMergeRequest; await executeCustomerMerge(access, request, deps.store); res.status(204).end(); } catch (cause) { sendError(res, cause); } });
  return router;
}
