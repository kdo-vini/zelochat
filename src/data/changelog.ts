import { PRICING } from './pricing';

export type ChangeCategory = 'big' | 'medium' | 'minor' | 'hotfix';

export interface ChangelogEntry {
  date: string; // YYYY-MM-DD
  category: ChangeCategory;
  title: string;
  description: string;
}

/**
 * Add a new entry at the TOP of this array for each release.
 * Keep descriptions user-friendly — no tech jargon, no code terms.
 * Categories: big (new major feature), medium (improvement), minor (small tweak), hotfix (urgent fix)
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-05-06',
    category: 'big',
    title: 'IA entende fotos e PDFs do cliente',
    description: 'Agora a IA olha imagens (de produtos, embalagens, comprovantes) e arquivos PDF enviados no chat e responde com base no que viu — sem precisar o cliente descrever em texto.',
  },
  {
    date: '2026-05-06',
    category: 'big',
    title: 'IA pode conferir comprovante Pix',
    description: 'Lojas habilitadas podem exigir comprovante por imagem ou PDF antes da IA confirmar pedidos pagos via Pix.',
  },
  {
    date: '2026-05-05',
    category: 'medium',
    title: 'IA agora espera o cliente terminar de digitar',
    description: 'Quando o cliente manda várias mensagens em sequência, a IA aguarda alguns segundos, marca como lida, mostra "digitando..." e responde uma vez só — igual um atendente humano faria.',
  },
  {
    date: '2026-05-04',
    category: 'medium',
    title: 'IA entende pedidos misturados',
    description: 'Quando o cliente mistura mais de um assunto, como consultar um pedido e fazer outro, a IA consegue tratar as partes importantes sem passar por cima de um pedido de atendente.',
  },
  {
    date: '2026-05-04',
    category: 'medium',
    title: 'IA entende cento e meio cento',
    description: 'Pedidos de salgados por cento ou meio cento ficam mais naturais, e quando houver dúvida a conversa vai para um atendente em vez de arriscar.',
  },
  {
    date: '2026-05-04',
    category: 'medium',
    title: 'Datas nas conversas',
    description: 'Agora dá pra ver "Hoje", "Ontem" e datas anteriores separando as mensagens dentro de cada chat — fica fácil de saber quando cada coisa foi dita.',
  },
  {
    date: '2026-05-02',
    category: 'medium',
    title: 'Gestão por conversa mais segura',
    description: 'O Cérebro IA agora consegue ajustar datas, horários, avisos e preferências da loja pela conversa, com validação antes de salvar.',
  },
  {
    date: '2026-05-01',
    category: 'medium',
    title: 'Mensagens podem ser apagadas',
    description: 'No atendimento, mensagens enviadas pelo painel agora podem ser apagadas para todos quando o WhatsApp permite. Edicao nao aparece porque o WhatsApp real ainda nao oferece essa acao pela API usada.',
  },
  {
    date: '2026-05-01',
    category: 'big',
    title: 'Visão geral virou painel de operação',
    description: 'A tela inicial agora mostra métricas reais de atendimento e pedidos, com filtros por período, ajuda de IA no manual e mensagens formatadas como no WhatsApp.',
  },
  {
    date: '2026-05-01',
    category: 'medium',
    title: 'IA entende imagens e nomes do cardápio',
    description: 'A IA agora usa fotos recebidas no WhatsApp para entender melhor o contexto, como lanches e comprovantes Pix, e também reconhece variações simples nos nomes dos produtos.',
  },
  {
    date: '2026-05-01',
    category: 'hotfix',
    title: 'IA segue regras importantes com mais firmeza',
    description: 'As orientações de estilo da loja agora ajudam no tom da resposta, mas não podem mudar regras de preço, entrega, Pix, horário ou confirmação de pedido.',
  },
  {
    date: '2026-05-01',
    category: 'hotfix',
    title: 'IA recupera dados da loja sozinha',
    description: 'Mesmo depois de uma reinicialização, a IA agora busca cardápio, Pix, entrega e horários direto da loja antes de responder clientes.',
  },
  {
    date: '2026-04-30',
    category: 'hotfix',
    title: 'IA espera para entender áudios',
    description: 'Quando o cliente manda áudio, a IA agora aguarda a transcrição antes de responder, evitando pedidos de texto quando o áudio já pode ser entendido.',
  },
  {
    date: '2026-04-30',
    category: 'hotfix',
    title: 'IA mantém o dia combinado do pedido',
    description: 'Quando o cliente continua um pedido já agendado, a IA agora respeita o dia e horário que já estavam na conversa antes de pedir produto ou pagamento.',
  },
  {
    date: '2026-04-30',
    category: 'hotfix',
    title: 'IA não aceita horário que já passou',
    description: 'Pedidos para hoje agora precisam estar em um horário futuro; se o cliente pedir um horário que já passou, a IA avisa na hora e oferece outra opção.',
  },
  {
    date: '2026-04-30',
    category: 'hotfix',
    title: 'IA respeita horário de atendimento',
    description: 'Quando o cliente pede para hoje ou informa um horário fora do funcionamento, a IA avisa na hora e oferece outro horário, outro dia ou atendimento humano.',
  },
  {
    date: '2026-04-30',
    category: 'hotfix',
    title: 'IA respeita datas bloqueadas na hora',
    description: 'Quando um cliente pede encomenda para feriado ou outra data bloqueada na agenda, a IA avisa imediatamente e oferece outro dia ou atendimento humano.',
  },
  {
    date: '2026-04-30',
    category: 'medium',
    title: 'Áudios com problema chamam um atendente',
    description: 'Quando o sistema não consegue entender vários áudios seguidos, a conversa passa para atendimento humano e o cliente recebe um aviso claro.',
  },
  {
    date: '2026-04-29',
    category: 'hotfix',
    title: 'Conversas de cada conta ficam isoladas',
    description: 'Corrigimos uma falha em que, em raras situações, mensagens recebidas em uma conta podiam aparecer em outra conta vinculada à mesma empresa-mãe. Agora cada conta só vê e responde às próprias conversas.',
  },
  {
    date: '2026-04-29',
    category: 'hotfix',
    title: 'Botão "Desativar IA" agora é respeitado de verdade',
    description: 'Corrigimos uma falha em que a IA podia continuar respondendo mesmo com o assistente desativado nas Configurações, em alguns momentos após o sistema reiniciar. Agora a IA só responde quando o botão estiver ligado de verdade.',
  },
  {
    date: '2026-04-29',
    category: 'medium',
    title: 'Mudar de plano sem sair do ZeloChat',
    description: 'Agora dá pra trocar de plano direto aqui em Configurações > Assinatura — antes você era levado pra outro site pra fazer upgrade. Quem tem só o ZeloPDV pode adicionar o atendimento por WhatsApp num clique, e quem usa o pacote completo pode voltar pra só atendimento se quiser. A diferença vai pra próxima fatura, sem cobrança imediata.',
  },
  {
    date: '2026-04-29',
    category: 'minor',
    title: 'Conexões WhatsApp mais seguras para novas empresas',
    description: 'Cada nova empresa recebe um endereço de webhook exclusivo com alta aleatoriedade, tornando impossível adivinhar ou enumerar os endereços de outras contas.',
  },
  {
    date: '2026-04-28',
    category: 'hotfix',
    title: 'Histórico completo: mensagens do celular agora aparecem',
    description: 'Respostas enviadas diretamente pelo WhatsApp do operador já aparecem na conversa do ZeloChat, mantendo o histórico completo.',
  },
  {
    date: '2026-04-28',
    category: 'medium',
    title: 'Pedidos agora têm campo de observação',
    description: 'Antes de mandar o botão de confirmar, a IA pergunta ao cliente se ele quer alterar algo ou tem alguma observação ("sem cebola", "ponto da carne", "deixar na portaria"…). Assim o cliente pensa duas vezes antes de bater o martelo, e a cozinha recebe o recado direitinho — sem precisar acionar atendente pra cada ajuste depois do pedido confirmado. No painel, pedidos com observação ficam destacados em amarelo no kanban e nos detalhes. Quem cria pedido manual em Produção também ganhou um campo de observação no formulário.',
  },
  {
    date: '2026-04-28',
    category: 'medium',
    title: 'Escolha o tipo do trigger com 1 clique',
    description: 'Ao criar um trigger personalizado, agora você decide na hora se é Notificar (gerente recebe um aviso e a IA continua) ou Escalar (a IA pausa e você assume) — basta clicar na pílula colorida ao lado do input. Antes a IA classificava sozinha pelo texto e às vezes errava o tipo.',
  },
  {
    date: '2026-04-28',
    category: 'hotfix',
    title: 'Impressão automática de pedidos volta a funcionar',
    description: 'Pedidos novos do WhatsApp voltam a sair na impressora térmica automaticamente, e o botão "Imprimir teste" agora mostra direitinho qualquer erro que aconteça (em vez de ficar mudo). Também convive sem briga com o Zelo PDV — se os dois apps tentarem imprimir ao mesmo tempo, um espera o outro liberar a impressora.',
  },
  {
    date: '2026-04-28',
    category: 'big',
    title: `ZeloChat Pro chegou: WhatsApp com IA por R$ ${PRICING.chat.priceBRL}/mês`,
    description: `Ative o plano direto no app — a IA atende seus clientes pelo WhatsApp 24/7. Pagamento, troca de cartão e cancelamento ficam no portal seguro do Stripe, acessível pelo botão "Gerenciar assinatura". Quem já é cliente do ZeloPDV pega o Pacote Gestão + Atendimento por R$ ${PRICING.bundle.priceBRL}/mês — uma cobrança só, R$ 9 mais barato.`,
  },
  {
    date: '2026-04-27',
    category: 'medium',
    title: 'Pedidos sincronizam em tempo real',
    description: 'Produção e Agenda agora atualizam sozinhas — ao trocar de aba ou quando algo muda, a lista reflete na hora sem precisar dar F5. A impressão automática de pedidos do WhatsApp também voltou a disparar corretamente.',
  },
  {
    date: '2026-04-27',
    category: 'hotfix',
    title: 'Kanban e notificações agora funcionam direito',
    description: 'Arrastar pedido entre colunas agora salva corretamente. Notificações ao cliente diferem retirada de delivery ("Pode vir buscar" vs "Sairá para entrega"). IA entende endereços informais. Avisos aparecem na thread de chat.',
  },
  {
    date: '2026-04-27',
    category: 'big',
    title: 'Despache motoboy e avise o cliente sem sair do Zelo',
    description: 'O botão "Despachar motoboy" agora envia uma mensagem completa pelo próprio WhatsApp da sua empresa — com cliente, endereço, pagamento, itens e total. E a cada mudança de status no kanban (Preparando, Pronto, Saiu pra entrega), o cliente recebe um aviso automático. Ative cada notificação em Configurações → Notificações ao cliente. O kanban também ganhou a coluna "Saiu pra entrega" entre Pronto e Entregue.',
  },
  {
    date: '2026-04-27',
    category: 'big',
    title: 'Impressão automática de pedidos',
    description: 'Conecte sua impressora térmica USB diretamente no navegador — sem instalar nada. A cada pedido confirmado pelo WhatsApp, o ticket é impresso automaticamente. Clique em "Conectar impressora" na barra lateral para parear.',
  },
  {
    date: '2026-04-27',
    category: 'medium',
    title: 'A IA agora aceita e calcula pedidos de entrega',
    description: 'Configure os bairros atendidos e as taxas em Configurações → Entrega. A IA passa a perguntar se é retirada ou entrega, coleta o endereço, calcula a taxa automaticamente e inclui no resumo do pedido. Bairros fora da lista vão direto para atendimento humano.',
  },
  {
    date: '2026-04-26',
    category: 'big',
    title: 'Transcrição automática de áudios',
    description: 'Cada áudio recebido agora aparece transcrito embaixo do player em poucos segundos — você lê na hora sem precisar dar play. A IA também passa a entender o conteúdo dos áudios e responder com base no que o cliente disse.',
  },
  {
    date: '2026-04-26',
    category: 'medium',
    title: 'Player de áudio no estilo WhatsApp',
    description: 'Mensagens de voz recebidas agora exibem um player com forma de onda e barra de progresso — igual ao WhatsApp. Não é mais necessário baixar o arquivo para ouvir.',
  },
  {
    date: '2026-04-26',
    category: 'big',
    title: 'ZeloChat funciona no celular',
    description: 'O sistema agora tem layout responsivo: no celular a lista de conversas ocupa a tela inteira, e ao tocar em uma conversa ela abre em tela cheia com botão de voltar. A navegação vira uma barra de abas na parte inferior — igual ao WhatsApp.',
  },
  {
    date: '2026-04-20',
    category: 'medium',
    title: 'Botões de status na gaveta de pedidos',
    description: 'Na tela de Produção, ao abrir um pedido você pode avançar o status diretamente — sem precisar arrastar no kanban. Ideal para uso no celular.',
  },
  {
    date: '2026-04-15',
    category: 'big',
    title: 'Histórico de escalações',
    description: 'Sempre que o assistente identificar frustração ou pedido de atendimento humano, um alerta aparece na conversa. O operador pode reconhecer e resolver cada escalação individualmente.',
  },
  {
    date: '2026-04-10',
    category: 'medium',
    title: 'Respostas rápidas',
    description: 'Crie atalhos de texto que o operador pode inserir nas conversas com um clique. Economiza tempo em perguntas frequentes.',
  },
  {
    date: '2026-04-05',
    category: 'big',
    title: 'Assistente de IA configurável',
    description: 'O Cérebro IA agora tem instruções personalizadas, gatilhos automáticos e resposta automática por conversa. Configure o tom, as regras e quando o assistente deve ou não responder.',
  },
];
