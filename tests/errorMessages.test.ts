import { getFriendlyErrorMessage } from '../src/services/errorMessages.js';
import { assertEqual, runSuite } from './testHarness.js';

await runSuite('Friendly error messages', [
  {
    name: 'auth errors are translated for operators',
    run: () => {
      assertEqual(
        getFriendlyErrorMessage(new Error('Invalid login credentials')),
        'E-mail ou senha incorretos.',
        'invalid credentials are translated',
      );
      assertEqual(
        getFriendlyErrorMessage({ message: 'Email not confirmed' }),
        'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
        'unconfirmed e-mail is translated',
      );
      assertEqual(
        getFriendlyErrorMessage('User already registered'),
        'Este e-mail já está cadastrado. Faça login.',
        'duplicate signup is translated',
      );
    },
  },
  {
    name: 'network and WhatsApp errors avoid raw stack-like text',
    run: () => {
      assertEqual(
        getFriendlyErrorMessage(new Error('Failed to fetch')),
        'Erro de conexão. Verifique sua internet e tente novamente.',
        'fetch failure is friendly',
      );
      assertEqual(
        getFriendlyErrorMessage(new Error('WebSocket not connected')),
        'WhatsApp desconectado no momento. Aguarde alguns segundos e tente novamente.',
        'websocket failure is friendly',
      );
      assertEqual(
        getFriendlyErrorMessage(new Error('Servidor WhatsApp offline')),
        'Servidor WhatsApp offline. Verifique se o servidor está ativo e tente novamente.',
        'server WhatsApp offline is friendly',
      );
    },
  },
  {
    name: 'unknown errors still have a fallback',
    run: () => {
      assertEqual(getFriendlyErrorMessage(null), 'Algo deu errado. Tente novamente.', 'null error has fallback');
      assertEqual(getFriendlyErrorMessage('Erro XPTO'), 'Erro XPTO', 'unknown string is preserved');
    },
  },
]);
