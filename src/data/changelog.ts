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
    date: '2026-05-21',
    category: 'big',
    title: 'Pagamento da assinatura por Pix',
    description: 'Agora dá pra pagar a mensalidade do ZeloChat por Pix, além do cartão. Em Configurações, escolha o plano, gere o QR Code (ou use o copia-e-cola) e o acesso é liberado na hora assim que o pagamento cai. Sem precisar de cartão de crédito.',
  },
  {
    date: '2026-05-21',
    category: 'medium',
    title: 'Painel do pedido direto na conversa',
    description: 'Ao abrir uma conversa, o painel lateral agora mostra o pedido em andamento do cliente: itens, total, endereço e se o PIX foi validado. Dá pra avançar o pedido pro preparo (ou marcar como pronto, saiu pra entrega, entregue) sem precisar abrir o Kanban. Também exibe quantos pedidos o cliente já fez e o ticket médio.',
  },
  {
    date: '2026-05-20',
    category: 'minor',
    title: 'Aviso quando o ZeloChat for atualizado',
    description: 'Sempre que lançarmos uma nova versão, um aviso discreto aparece no canto da tela com o botão "Atualizar agora". Assim você sempre roda a versão mais recente sem precisar lembrar de recarregar.',
  },
  {
    date: '2026-05-19',
    category: 'hotfix',
    title: 'Mensagens manuais voltaram a sair pelo WhatsApp',
    description: 'Corrigimos o envio feito pelo atendente no chat para que a mensagem só apareça como enviada quando o WhatsApp realmente aceitar o envio.',
  },
  {
    date: '2026-05-17',
    category: 'hotfix',
    title: 'IA voltou a responder em todos os horários',
    description: 'Em algumas lojas, a IA estava ficando muda para certos clientes — sem mandar nem uma resposta. Corrigimos o problema. Agora, sempre que a IA estiver no modo "Sempre ligada" (ou dentro do horário agendado), ela responde todo cliente. Em dias marcados como fechados, ela responde cumprimentando e avisando que hoje não atendemos, oferecendo agendar pra outro dia.',
  },
  {
    date: '2026-05-15',
    category: 'hotfix',
    title: 'Sistema mais leve em dias de alto movimento',
    description: 'Conversas, pedidos e cardápio carregam de forma mais controlada para lojas com muito movimento acumulado, evitando travamentos ao abrir o sistema.',
  },
  {
    date: '2026-05-14',
    category: 'hotfix',
    title: 'Áudios do WhatsApp voltam a aparecer no chat',
    description: 'Áudios enviados pelo cliente estavam ficando "travados" e deixando a conversa lenta para abrir. Agora aparecem rapidamente como um player de áudio normal, junto com imagens e documentos.',
  },
  {
    date: '2026-05-14',
    category: 'medium',
    title: 'Chat mostra melhor o andamento dos pedidos',
    description: 'Pedidos em conferência, pedido confirmado, comprovante Pix pendente e avisos internos da IA agora aparecem em cards mais claros dentro da conversa. Quando o pedido já entrou na produção, você também pode abrir a fila direto por ali.',
  },
  {
    date: '2026-05-14',
    category: 'minor',
    title: 'Caixa de mensagem mais espaçosa',
    description: 'Os botões de imagem, vídeo, documento e contato agora ficam reunidos em um único botão de clipe que abre as opções pra cima. O microfone foi pro lado do botão de enviar, deixando muito mais espaço pra digitar.',
  },
  {
    date: '2026-05-14',
    category: 'big',
    title: 'Tags de atendimento por perfil de cliente',
    description: 'Agora você pode criar tags coloridas para classificar seus contatos (ex: Revendedor, Lead, VIP) e definir instruções específicas para a IA se comportar diferente com cada perfil. As tags aparecem como bolinhas coloridas na lista de conversas e podem ser aplicadas ou removidas no painel do cliente.',
  },
  {
    date: '2026-05-13',
    category: 'big',
    title: 'IA começa a lembrar das preferências de cada cliente',
    description: 'A IA vai aprendendo com cada atendimento: se o cliente sempre pede sem cebola, costuma pedir às sextas ou prefere deixar na portaria, ela vai lembrando entre conversas e personalizando o atendimento automaticamente.',
  },
  {
    date: '2026-05-13',
    category: 'medium',
    title: 'Estoque abaixa sozinho quando pedido é confirmado',
    description: 'Produtos com controle de estoque têm a quantidade descontada automaticamente assim que a IA confirma um pedido — sem precisar ajustar na mão depois.',
  },
  {
    date: '2026-05-13',
    category: 'hotfix',
    title: 'IA voltou a responder em conversas longas',
    description: 'Em atendimentos com histórico muito extenso, a IA podia travar ao tentar gerar uma resposta assistida pelo operador. Corrigido.',
  },
  {
    date: '2026-05-12',
    category: 'medium',
    title: 'Vídeo, arrastar arquivos e envio de contato',
    description: 'Agora dá pra enviar vídeos pro cliente direto pelo painel, arrastar qualquer arquivo ou imagem pra enviar sem precisar clicar em botão, e compartilhar contatos do WhatsApp pela conversa.',
  },
  {
    date: '2026-05-12',
    category: 'medium',
    title: 'Quebra de linha no chat e Cérebro IA com mais espaço',
    description: 'Agora dá pra quebrar linha no chat com Shift+Enter ou Ctrl+Enter — texto colado com formatação aparece igual ao WhatsApp. O campo do Cérebro IA também ficou maior e dá pra arrastar pra expandir, com mais espaço pra detalhar as instruções.',
  },
  {
    date: '2026-05-09',
    category: 'hotfix',
    title: 'Conversas recentes na ordem certa',
    description: 'A lista volta a priorizar as mensagens mais novas, mantendo apenas as conversas fixadas acima das demais.',
  },
  {
    date: '2026-05-09',
    category: 'hotfix',
    title: 'Painel abre mais rápido',
    description: 'Ao recarregar o sistema, o atendimento aparece primeiro e o restante do painel entra sem travar a lista de conversas.',
  },
  {
    date: '2026-05-09',
    category: 'hotfix',
    title: 'Conversas fixadas abrem sem trocar o histórico',
    description: 'Ao fixar uma conversa e abrir depois, o painel mantém o chat certo e mostra todas as mensagens daquele cliente.',
  },
  {
    date: '2026-05-09',
    category: 'medium',
    title: 'Pedido manual agora pode nascer da conversa',
    description: 'No atendimento manual, o botão da IA agora monta um pedido já preenchido com base no chat para você revisar e salvar. A IA também ficou mais esperta para não repetir resumo quando o cliente já encerrou a conferência do pedido.',
  },
  {
    date: '2026-05-06',
    category: 'hotfix',
    title: 'Mensagens enviadas pelo celular voltam a aparecer no painel',
    description: 'Quando você pausava a IA pra atender no WhatsApp e respondia direto pelo celular, suas respostas podiam não aparecer no painel da conversa. Já corrigido.',
  },
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
    description: 'Instale o Zelo Impressão no computador da operação e conecte uma única vez na barra lateral. A partir daí, todo pedido criado é impresso automaticamente na cozinha — sem precisar fazer nada.',
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
