export function getFriendlyErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string'
            ? (err as { message: string }).message
            : '');

  const msg = raw.toLowerCase();

  if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
    return 'E-mail ou senha incorretos.';
  }
  if (msg.includes('email not confirmed') || msg.includes('not_confirmed')) {
    return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
  }
  if (msg.includes('user not found')) {
    return 'Usuário não encontrado.';
  }
  if (msg.includes('already registered') || msg.includes('user already exists') || msg.includes('already been registered')) {
    return 'Este e-mail já está cadastrado. Faça login.';
  }
  if (msg.includes('password should be at least') || msg.includes('password_too_short')) {
    return 'A senha deve ter pelo menos 8 caracteres.';
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }
  if (msg.includes('servidor whatsapp offline')) {
    return 'Servidor WhatsApp offline. Verifique se o servidor está ativo e tente novamente.';
  }
  if (msg.includes('websocket not connected') || msg.includes('failed to send') || msg.includes('not connected')) {
    return 'WhatsApp desconectado no momento. Aguarde alguns segundos e tente novamente.';
  }
  if (msg.includes('network') || msg.includes('failed to fetch')) {
    return 'Erro de conexão. Verifique sua internet e tente novamente.';
  }
  if (msg.includes('invalid email')) {
    return 'E-mail inválido.';
  }
  if (msg.includes('weak_password') || msg.includes('weak password')) {
    return 'Senha muito fraca. Use pelo menos 8 caracteres com letras e números.';
  }
  if (msg.includes('same_password')) {
    return 'A nova senha deve ser diferente da atual.';
  }

  return raw || 'Algo deu errado. Tente novamente.';
}
