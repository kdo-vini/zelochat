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
