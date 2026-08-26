import { assert, assertEqual, runSuite } from './testHarness.js';
import { AccessControlError } from '../server/accessControl.js';

type JsonResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => JsonResponse;
  json: (value: unknown) => JsonResponse;
};

function responseForTest(): JsonResponse {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(value: unknown) {
      response.body = value;
      return response;
    },
  };
  return response;
}

const authErrorsModule = await import('../server/authErrors.js').catch(() => null) as {
  sendAuthError?: (res: JsonResponse, error: unknown) => void;
} | null;
const billingModule = await import('../server/billing.js').catch(() => null) as {
  sendBillingError?: (res: JsonResponse, error: unknown) => void;
} | null;

await runSuite('access error mapping', [
  {
    name: 'onboarding owner denial is mapped to friendly FORBIDDEN response',
    run: async () => {
      assert(authErrorsModule?.sendAuthError !== undefined, 'router auth mapper is available');
      if (!authErrorsModule?.sendAuthError) return;
      const response = responseForTest();
      authErrorsModule.sendAuthError(response, new AccessControlError('FORBIDDEN'));
      const body = response.body as { error?: string; code?: string };
      assertEqual(response.statusCode, 403, 'owner-only denial is HTTP 403');
      assertEqual(body.code, 'FORBIDDEN', 'forbidden code remains structured');
      assert(body.error === 'Você não tem permissão para realizar esta ação.', 'forbidden copy is friendly');
    },
  },
  {
    name: 'Stripe empresa lookup denial is mapped without exposing internal text',
    run: async () => {
      assert(billingModule?.sendBillingError !== undefined, 'billing mapper is available');
      if (!billingModule?.sendBillingError) return;
      const response = responseForTest();
      billingModule.sendBillingError(response, new AccessControlError('EMPRESA_NOT_FOUND'));
      const body = response.body as { error?: string; code?: string };
      assertEqual(response.statusCode, 404, 'missing empresa is HTTP 404');
      assertEqual(body.code, 'EMPRESA_NOT_FOUND', 'empresa code remains structured');
      assert(body.error === 'Não encontramos sua empresa. Confira o acesso e tente novamente.', 'empresa copy is friendly');
      assert(body.error !== 'EMPRESA_NOT_FOUND', 'internal code is not used as external text');
    },
  },
]);
