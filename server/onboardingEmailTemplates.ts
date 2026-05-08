/**
 * Email templates for the post-onboarding follow-up sequence.
 *
 * Each template returns `{ subject, html, text }`. HTML is intentionally simple
 * (table-based layout, no MJML) to maximize client compatibility. Plain-text
 * fallback is included for clients that don't render HTML.
 *
 * Brand: ZeloChat green `#25D366`. Sender footer points to the app URL via
 * APP_URL (defaults to https://chat.zelopdv.com.br).
 *
 * Convention: lead with a single, concrete action. Footer signs as "Vinicius
 * — fundador do ZeloChat" and gives a direct WhatsApp reply path.
 */

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://chat.zelopdv.com.br').replace(/\/$/, '');
const FOUNDER_WHATSAPP = '5514991537503';

interface TemplateInput {
  firstName: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function shell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e4e7">
        <tr><td style="background:#25D366;padding:18px 28px">
          <p style="margin:0;color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.01em">ZeloChat</p>
        </td></tr>
        <tr><td style="padding:32px 28px">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #f4f4f5;background:#fafafa">
          <p style="margin:0 0 6px;color:#52525b;font-size:13px;line-height:1.5">— Vinicius, fundador do ZeloChat</p>
          <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.5">
            Dúvida? <a href="https://wa.me/${FOUNDER_WHATSAPP}" style="color:#16a34a;text-decoration:none">me chama no WhatsApp</a> ·
            <a href="${APP_URL}" style="color:#a1a1aa;text-decoration:none">${APP_URL.replace(/^https?:\/\//, '')}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

function ctaButton(label: string, href: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:20px 0"><tr><td>
    <a href="${href}" style="display:inline-block;background:#25D366;color:#fff;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;text-decoration:none">${label}</a>
  </td></tr></table>`;
}

/** Day 0 — Welcome + 3 next steps. Sent synchronously at onboarding completion. */
export function dayZeroEmail({ firstName }: TemplateInput): RenderedEmail {
  const subject = '👋 Bem-vindo ao ZeloChat — vamos colocar sua IA pra atender';
  const html = shell(subject, `
    <p style="margin:0 0 14px;font-size:18px;font-weight:600">Oi ${firstName}!</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Sua conta no ZeloChat está pronta. Em 5 minutos sua IA já tá respondendo cliente no WhatsApp por você.</p>
    <p style="margin:0 0 10px;font-size:15px;line-height:1.55"><strong>Próximos 3 passos:</strong></p>
    <ol style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.7;color:#3f3f46">
      <li><strong>Conectar o WhatsApp</strong> — leia o QR Code em Configurações → Conectar WhatsApp.</li>
      <li><strong>Escrever as instruções da IA</strong> — conte como ela deve falar, o que pode oferecer e o que não pode.</li>
      <li><strong>Cadastrar respostas rápidas</strong> — atalhos pras perguntas que mais aparecem (horário, endereço, formas de pagamento).</li>
    </ol>
    ${ctaButton('Abrir ZeloChat →', APP_URL)}
    <p style="margin:18px 0 0;font-size:14px;color:#52525b;line-height:1.55">Se travar em algum passo, me responde aqui ou no WhatsApp — eu mesmo te ajudo.</p>
  `);
  const text = `Oi ${firstName}! Sua conta no ZeloChat está pronta. Próximos passos: 1) Conectar WhatsApp em Configurações, 2) Escrever instruções da IA, 3) Cadastrar respostas rápidas. Acesse: ${APP_URL}`;
  return { subject, html, text };
}

/** Day 3 — Hidden value: features under-discovered. */
export function dayThreeEmail({ firstName }: TemplateInput): RenderedEmail {
  const subject = '3 recursos do ZeloChat que quase ninguém usa (mas deveria)';
  const html = shell(subject, `
    <p style="margin:0 0 14px;font-size:18px;font-weight:600">${firstName}, dá uma olhada nisso 👀</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">A maioria dos clientes leva semanas pra descobrir essas três coisas. Tô mandando um atalho:</p>
    <p style="margin:18px 0 8px;font-size:15px;line-height:1.55"><strong>1. Gatilhos automáticos</strong></p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#52525b">Sua IA pode mandar mensagem sozinha quando o cliente abandona um pedido, quando muda de status, ou em horários específicos. Configurações → Automações.</p>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.55"><strong>2. Escalonamento humano</strong></p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#52525b">Quando a IA não souber resolver, ela pode te chamar direto no WhatsApp do gerente. Você assume a conversa, ela volta a atender quando você libera.</p>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.55"><strong>3. Motoboys</strong></p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#52525b">Cadastre seus entregadores e a IA já avisa o cliente quando o pedido sai pra entrega. Sem precisar copiar/colar nome ou número.</p>
    ${ctaButton('Configurar essas automações →', APP_URL + '/settings')}
  `);
  const text = `Oi ${firstName}! Três recursos pouco descobertos do ZeloChat: 1) Gatilhos automáticos, 2) Escalonamento humano, 3) Motoboys. Configure em ${APP_URL}/settings`;
  return { subject, html, text };
}

/** Day 7 — Conversion: social proof + reasons to subscribe. */
export function daySevenEmail({ firstName }: TemplateInput): RenderedEmail {
  const subject = `Você ainda tá testando? ${firstName}, deixa eu te contar uma coisa`;
  const html = shell(subject, `
    <p style="margin:0 0 14px;font-size:18px;font-weight:600">Oi ${firstName},</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Faz uma semana que você criou conta no ZeloChat. Já testou pra ver se faz sentido pro seu negócio?</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Quem assina hoje resolve três coisas que enchem saco no dia a dia:</p>
    <ul style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.7;color:#3f3f46">
      <li>Não precisa mais responder mensagem repetitiva — a IA cuida.</li>
      <li>Cliente que mandou no horário de pico não fica esperando 40 min.</li>
      <li>Pedido cai direto no sistema, sem você anotar no caderno.</li>
    </ul>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">A assinatura sai por <strong>R$97/mês</strong>, sem fidelidade. Se um mês não fizer sentido, cancela e pronto.</p>
    ${ctaButton('Assinar ZeloChat →', APP_URL + '/settings')}
    <p style="margin:18px 0 0;font-size:14px;color:#52525b;line-height:1.55">Se ainda tá em dúvida sobre algum recurso, me chama. Respondo em minutos.</p>
  `);
  const text = `${firstName}, faz uma semana que você criou conta. ZeloChat sai por R$97/mês sem fidelidade. Assine: ${APP_URL}/settings`;
  return { subject, html, text };
}

/** Day 21 — Conversion: success story. */
export function dayTwentyOneEmail({ firstName }: TemplateInput): RenderedEmail {
  const subject = 'Como a Pizzaria do Léo deixou de perder pedido às 21h 🍕';
  const html = shell(subject, `
    <p style="margin:0 0 14px;font-size:18px;font-weight:600">${firstName}, queria te contar um caso real</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">O Léo tem uma pizzaria pequena no interior. Mensagem de WhatsApp dele bombava entre 19h e 22h — três a cinco mensagens por minuto. Não dava conta de responder e atender o salão ao mesmo tempo.</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Resultado: <strong>todo dia ele perdia pedido</strong>. Cliente mandava, ele só via 30 min depois, daí já tinha desistido e ido em outra.</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Com o ZeloChat ligado:</p>
    <ul style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.7;color:#3f3f46">
      <li>A IA pega o pedido, confirma sabor, endereço, forma de pagamento.</li>
      <li>O Léo só vê o pedido quando já tá montado no sistema, com tudo certo.</li>
      <li>Mês passado fechou <strong>22% mais pedidos</strong> só recuperando esses que escapavam à noite.</li>
    </ul>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Se essa cena te lembra alguma coisa, dá um pulo no ZeloChat e ativa.</p>
    ${ctaButton('Ativar ZeloChat →', APP_URL + '/settings')}
  `);
  const text = `${firstName}, caso real: pizzaria perdia pedido às 21h, ativou o ZeloChat e fechou 22% mais. Veja se faz sentido pro seu negócio: ${APP_URL}/settings`;
  return { subject, html, text };
}

/** Day 28 — Last chance / final CTA. */
export function dayTwentyEightEmail({ firstName }: TemplateInput): RenderedEmail {
  const subject = `${firstName}, último toque sobre o ZeloChat`;
  const html = shell(subject, `
    <p style="margin:0 0 14px;font-size:18px;font-weight:600">Oi ${firstName},</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Esse é o último email que te mando sobre o ZeloChat. Não quero virar spam na sua caixa de entrada.</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Se a IA atendendo cliente automaticamente não fizer sentido pro seu negócio agora, beleza — sua conta continua aqui. Se um dia mudar de ideia, é só voltar.</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Mas se você tá em cima do muro, deixa eu te lembrar que:</p>
    <ul style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.7;color:#3f3f46">
      <li>Não tem fidelidade. Cancela quando quiser.</li>
      <li>R$97/mês — menos que um pedido perdido por dia.</li>
      <li>Se travar em algo, me chama no WhatsApp e eu te ajudo na hora.</li>
    </ul>
    ${ctaButton('Assinar agora →', APP_URL + '/settings')}
    <p style="margin:18px 0 0;font-size:14px;color:#52525b;line-height:1.55">Boa sorte com o negócio, ${firstName}. Espero te ver por aqui.</p>
  `);
  const text = `${firstName}, último email sobre o ZeloChat. R$97/mês, sem fidelidade. Se fizer sentido: ${APP_URL}/settings`;
  return { subject, html, text };
}

/** WhatsApp messages — plain text, no HTML. */
export function dayZeroWhatsApp(firstName: string): string {
  return `Oi ${firstName}! Aqui é o Vinicius, fundador do ZeloChat. Vi que você acabou de criar sua conta — bem-vindo! 🎉\n\nSe travar em algum passo da configuração (conectar WhatsApp, escrever as instruções da IA), me responde aqui mesmo no zap que eu te ajudo.\n\nBoa sorte com o atendimento!`;
}

export function dayFourteenWhatsApp(firstName: string): string {
  return `Oi ${firstName}, tudo bem? Faz duas semanas que você criou conta no ZeloChat e queria saber como tá indo.\n\nA IA tá respondendo cliente direitinho? Tem alguma coisa que ainda não rolou ou que tá travando? Me responde aqui que eu te ajudo a destravar.\n\n— Vinicius, ZeloChat`;
}

export function dayTwentyEightWhatsApp(firstName: string): string {
  return `Oi ${firstName}! Esse é o último toque que te mando aqui pelo zap sobre o ZeloChat — não quero virar chato.\n\nSe fez sentido pro teu negócio, é só assinar em ${APP_URL}/settings. Se não fez, beleza, sua conta fica aí salva. Qualquer hora que quiser voltar, é só falar comigo.\n\nValeu pela chance! — Vinicius`;
}
