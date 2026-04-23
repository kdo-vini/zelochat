export interface BusinessConfig {
  name: string;
  specialty: string;
  hours: string;
  closedDays: string[];
  address: string;
  pixKey: string;
  products: { name: string; price: number; available: boolean }[];
  blockedDates: { date: string; reason: string }[];
  dailyContext: { id: string; text: string }[];
  aiInstructions: string;
}

const DEFAULT_CONFIG: BusinessConfig = {
  name: 'Casa dos Salgados',
  specialty: 'Coxinhas e salgados variados',
  hours: 'Segunda a Sábado, 9h às 18h',
  closedDays: ['Domingo'],
  address: '',
  pixKey: '',
  products: [],
  blockedDates: [],
  dailyContext: [],
  aiInstructions: '',
};

let config: BusinessConfig = { ...DEFAULT_CONFIG };

export function getConfig(): BusinessConfig {
  return config;
}

export function setConfig(c: BusinessConfig): void {
  config = { ...c };
}
