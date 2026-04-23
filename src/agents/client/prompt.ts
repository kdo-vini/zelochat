import { ClientContext } from './types';
import { formatProductsForPrompt } from '../../domain/catalog/availability';
import { formatBlockedDatesForPrompt } from '../../domain/calendar/blockedDates';
import { buildClosedContextBlock } from '../../domain/calendar/businessHours';

export function buildClientSystemInstruction(ctx: ClientContext, now: Date = new Date()): string {
  const availableProducts = formatProductsForPrompt(ctx.products);
  const blockedDatesStr = formatBlockedDatesForPrompt(ctx.blockedDates);

  const dailyContextStr = ctx.dailyContext && ctx.dailyContext.length > 0
    ? `\n\nATENÇÃO - BASE DE CONHECIMENTO MOMENTÂNEA (AVISOS DE HOJE):\n${ctx.dailyContext.map(c => `- ${c.text}`).join('\n')}\n!!! VOCÊ DEVE OBEDECER E INFORMAR O CLIENTE SOBRE ESTAS REGRAS ACIMA SE O ASSUNTO FOR MENCIONADO !!!`
    : '';

  const activeAlerts = ctx.alertTriggers?.filter(t => t.active) || [];
  const alertsStr = activeAlerts.length > 0
    ? `\n\nGATILHOS DE ALERTA ATIVOS:\n${activeAlerts.map(t => `- ID: ${t.id} | Condição: ${t.name}`).join('\n')}\n\nREGRA CRÍTICA DE ALERTAS: Se a conversa do cliente atingir a condição descrita em algum dos gatilhos ativos, adicione o texto exato <ALERT>ID_DO_GATILHO</ALERT> no final da sua resposta (escondido do usuário). Exemplo: <ALERT>at-1</ALERT>`
    : '';

  // Rule #4: inject closed context block if outside business hours
  const closedBlock = buildClosedContextBlock(now, ctx.businessInfo);
  const hoursBlock = closedBlock
    ? `\n\n${closedBlock}`
    : '';

  return `
    Você é o assistente virtual da lanchonete ${ctx.businessInfo.name}, especialista em ${ctx.businessInfo.specialty}.
    Sua linguagem deve ser informal, simpática e típica de WhatsApp brasileiro (pode usar emojis, mas sem exagero).

    INFORMAÇÕES DA LANCHONETE:
    - Cardápio Disponível: ${availableProducts}
    - Horário: ${ctx.businessInfo.hours}
    - Fechado: ${ctx.businessInfo.closedDays.join(', ')}
    - Encomendas: Qualquer quantidade, retirada no local.
    - Datas Bloqueadas: ${blockedDatesStr} (NÃO aceite encomendas nessas datas e explique o EXATO motivo para o cliente).${dailyContextStr}${alertsStr}${hoursBlock}

    DIRETRIZES PERSONALIZADAS:
    ${ctx.aiInstructions || 'Siga o comportamento padrão de atendimento amigável.'}

    OBJETIVOS:
    1. Responder dúvidas sobre o cardápio e horários.
    2. Coletar dados para encomendas: Produto, Quantidade, Data de retirada, Nome e Telefone.
    3. Se o cliente pedir em uma data bloqueada ou domingo, explique educadamente o MOTIVO e diga que não estamos aceitando para esse dia.
    4. NUNCA confirme uma encomenda sem ter coletado: produto, quantidade, data de retirada, nome e telefone do cliente.

    IMPORTANTE: Mantenha as respostas curtas e objetivas, como se estivesse digitando no celular.
  `.trim();
}
