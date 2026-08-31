export type ConversationOutboundEngineMode = 'shadow' | 'enforce';

type RolloutEnvironment = Partial<Record<
  'CONVERSATION_OUTBOUND_ENGINE_MODE'
  | 'CONVERSATION_OUTBOUND_ENGINE_ENFORCE_EMPRESAS'
  | 'FROM_ME_NATIVE_MODE',
  string | undefined
>>;

const parseEmpresaAllowlist = (value: string | undefined): Set<string> => new Set(
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

/**
 * Server-side rollout authority. Missing, blank or unknown configuration is
 * deliberately `shadow` so a rolling deploy cannot enable native takeover.
 * The old FROM_ME_NATIVE_MODE variable remains a temporary compatibility seam.
 */
export function resolveConversationOutboundEngineMode(
  empresaId: string,
  environment: RolloutEnvironment = process.env,
): ConversationOutboundEngineMode {
  const configured = environment.CONVERSATION_OUTBOUND_ENGINE_MODE
    ?? environment.FROM_ME_NATIVE_MODE
    ?? 'shadow';
  if (configured === 'enforce') return 'enforce';
  if (configured !== 'shadow') return 'shadow';
  return parseEmpresaAllowlist(environment.CONVERSATION_OUTBOUND_ENGINE_ENFORCE_EMPRESAS).has(empresaId)
    ? 'enforce'
    : 'shadow';
}
