import { ZeloState } from "./types";

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

export const INITIAL_STATE: ZeloState = {
  products: [],
  blockedDates: [{ date: daysFromNow(5), reason: 'Manutenção programada na loja' }],
  orders: [],
  sessions: [],
  aiInstructions: "Você é o assistente virtual da lanchonete ZeloChat. Responda clientes pelo WhatsApp. Você conhece o cardápio (coxinhas, kibe, pastel, etc), horários (seg-sáb 9h-18h) e disponibilidade. Não aceite pedidos em datas bloqueadas. Colete: produto, quantidade, data, NOME, ENDEREÇO (se for entrega) e telefone. Linguagem informal e simpática estilo BR.",
  quickResponses: [
    { id: 'qr-1', trigger: 'PIX', response: 'Claro! Nossa chave PIX é o CNPJ: 12.345.678/0001-99 (ZeloChat Lanchonete). Favor enviar o comprovante aqui para confirmarmos sua encomenda!' },
    { id: 'qr-2', trigger: 'LOCAL', response: 'Estamos localizados na Rua dos Salgados, 123 - Centro. Fica logo atrás da Praça Central! Aguardamos você!' },
    { id: 'qr-3', trigger: 'ENTREGA', response: 'Fazemos entregas via motoboy! A taxa varia conforme a região. Mande seu endereço completo com CEP que calculamos para você!' },
    { id: 'qr-4', trigger: 'FRITURA', response: 'Todos os nossos salgados são fritos na hora da sua retirada ou envio, para garantir que fiquem bem crocantes! Se preferir, também vendemos congelados.' },
  ],
  dailyContext: [],
  alertTriggers: [
    { id: 'at-1', name: 'Pedido acima de R$ 500', active: true },
    { id: 'at-2', name: 'Cliente irritado', active: true },
    { id: 'at-3', name: 'Data indisponível tentada 2x', active: true },
  ],
  managerHistory: [],
  drivers: [],
  businessInfo: {
    name: "ZeloChat Lanchonete",
    hours: "Segunda a Sábado, 9h às 18h",
    closedDays: ["Domingo"],
    specialty: "Coxinhas e salgados variados",
    address: "Rua dos Salgados, 123 - Centro",
    phone: "(11) 99999-8888",
    pixKey: "12.345.678/0001-99",
  },
  profile: {
    name: "Dona Maria",
    email: "maria@zelochat.com.br",
    role: "Proprietária",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Maria",
    notifications: true,
    darkMode: false,
  },
  notificationPrefs: {
    soundNewMessages: true,
    alertLargeOrders: true,
    dailyEmailReport: false,
    alertOutOfStock: true,
  },
};

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  preparing: 'Preparando',
  ready: 'Pronto',
  delivered: 'Entregue'
};

export const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-orange-100 text-orange-600',
  preparing: 'bg-blue-100 text-blue-600',
  ready: 'bg-green-100 text-green-600',
  delivered: 'bg-gray-100 text-gray-600'
};
