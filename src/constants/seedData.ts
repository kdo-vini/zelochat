import { ZeloState } from '../types/state';

export const INITIAL_STATE: ZeloState = {
  products: [
    { id: '1', name: 'Coxinha de Frango', price: 6.5, available: true, category: 'salgado' },
    { id: '2', name: 'Coxinha Cremosa', price: 7.0, available: true, category: 'salgado' },
    { id: '3', name: 'Kibe', price: 6.5, available: true, category: 'salgado' },
    { id: '4', name: 'Enroladinho', price: 6.5, available: true, category: 'salgado' },
    { id: '5', name: 'Risole', price: 6.5, available: true, category: 'salgado' },
    { id: '6', name: 'Pastel', price: 7.5, available: true, category: 'salgado' },
    { id: '7', name: 'Coca-Cola 2L', price: 12.0, available: true, category: 'bebida' },
    { id: '8', name: 'Coca-Cola Zero Lata', price: 6.0, available: true, category: 'bebida' },
  ],
  blockedDates: [{ date: '2026-04-28', reason: 'Manutenção programada na loja' }],
  orders: [
    {
      id: 'ord-1',
      customerName: 'João Silva',
      customerPhone: '(11) 98888-7777',
      items: [{ product: 'Coxinha de Frango', quantity: 20 }],
      pickupDate: '2026-04-23',
      pickupTime: '15:00',
      status: 'pending',
      total: 130.00,
      createdAt: '2026-04-22 10:45'
    },
    {
      id: 'ord-2',
      customerName: 'Maria Oliveira',
      customerPhone: '(11) 91234-5678',
      items: [{ product: 'Pastel', quantity: 10 }, { product: 'Kibe', quantity: 10 }],
      pickupDate: '2026-04-23',
      pickupTime: '17:30',
      deliveryAddress: 'Rua das Flores, 45 - Apto 32',
      status: 'preparing',
      total: 140.00,
      createdAt: '2026-04-22 11:30'
    },
    {
      id: 'ord-3',
      customerName: 'Pedro Santos',
      customerPhone: '(11) 97777-6666',
      items: [{ product: 'Coxinha Cremosa', quantity: 15 }],
      pickupDate: '2026-04-24',
      pickupTime: '10:00',
      status: 'ready',
      total: 105.00,
      createdAt: '2026-04-22 09:15'
    }
  ],
  sessions: [
    {
      id: 'cust-1',
      customerName: 'João Silva',
      customerPhone: '(11) 98888-7777',
      lastMessage: 'Queria encomendar 20 coxinhas',
      lastMessageTime: '10:45',
      unreadCount: 0,
      messages: [
        { id: 'm1', role: 'user', content: 'Oi, vocês fazem encomenda?', timestamp: '10:40' },
        { id: 'm2', role: 'assistant', content: 'Olá João! Fazemos sim. Quantas unidades você precisa e para quando?', timestamp: '10:41' },
      ],
      status: 'active'
    },
    {
      id: 'cust-2',
      customerName: 'Maria Oliveira',
      customerPhone: '(11) 91234-5678',
      lastMessage: 'Ainda tem kibe?',
      lastMessageTime: '11:02',
      unreadCount: 1,
      messages: [
        { id: 'm1', role: 'user', content: 'Bom dia! Ainda tem kibe?', timestamp: '11:02' }
      ],
      status: 'active'
    },
    {
      id: 'cust-3',
      customerName: 'Carlos (Teste de Estoque)',
      customerPhone: '(11) 95555-5555',
      lastMessage: 'Olá',
      lastMessageTime: '12:00',
      unreadCount: 1,
      messages: [
        { id: 'm1', role: 'user', content: 'Opa, bom dia!', timestamp: '12:00' }
      ],
      status: 'active'
    },
    {
      id: 'cust-4',
      customerName: 'Ana (Teste de Data)',
      customerPhone: '(11) 96666-6666',
      lastMessage: 'Queria fazer uma festa dia 28/04',
      lastMessageTime: '12:05',
      unreadCount: 1,
      messages: [
        { id: 'm1', role: 'user', content: 'Boa tarde, queria encomendar para o dia 28/04', timestamp: '12:05' }
      ],
      status: 'active'
    }
  ],
  aiInstructions: "Você é o assistente virtual da lanchonete ZeloChat. Responda clientes pelo WhatsApp. Você conhece o cardápio (coxinhas, kibe, pastel, etc), horários (seg-sáb 9h-18h) e disponibilidade. Não aceite pedidos em datas bloqueadas. Colete: produto, quantidade, data, NOME, ENDEREÇO (se for entrega) e telefone. Linguagem informal e simpática estilo BR.",
  quickResponses: [
    { id: 'qr-1', trigger: 'PIX', response: 'Claro! Nossa chave PIX é o CNPJ: 12.345.678/0001-99 (ZeloChat Lanchonete). Favor enviar o comprovante aqui para confirmarmos sua encomenda! 😉' },
    { id: 'qr-2', trigger: 'LOCAL', response: 'Estamos localizados na Rua dos Salgados, 123 - Centro. Fica logo atrás da Praça Central! Aguardamos você!' },
    { id: 'qr-3', trigger: 'ENTREGA', response: 'Fazemos entregas via motoboy! A taxa varia conforme a região. Mande seu endereço completo com CEP que calculamos para você! 🏍️' },
    { id: 'qr-4', trigger: 'FRITURA', response: 'Todos os nossos salgados são fritos na hora da sua retirada ou envio, para garantir que fiquem bem crocantes! Se preferir, também vendemos congelados. 😊' },
  ],
  dailyContext: [],
  alertTriggers: [
    { id: 'at-1', name: 'Pedido acima de R$ 500', active: true },
    { id: 'at-2', name: 'Cliente irritado', active: true },
    { id: 'at-3', name: 'Data indisponível tentada 2x', active: true },
  ],
  managerHistory: [],
  drivers: [
    { id: 'd-1', name: 'Carlos Motoboy', phone: '5511999991111', status: 'available' },
    { id: 'd-2', name: 'Zezinho Entregas', phone: '5511988882222', status: 'busy' },
  ],
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
  }
};
