export interface CatalogCategoriaGroup {
  nome: string;
  subcategorias: { nome: string; produtos: { name: string; price: number; available: boolean }[] }[];
  produtosDireto: { name: string; price: number; available: boolean }[];
}

export interface BusinessConfig {
  name: string;
  specialty: string;
  hours: string;
  closedDays: string[];
  address: string;
  pixKey: string;
  products: { name: string; price: number; available: boolean }[];
  catalogHierarchy: CatalogCategoriaGroup[];
  blockedDates: { date: string; reason: string }[];
  dailyContext: { id: string; text: string }[];
  aiInstructions: string;
  managerPhone: string;
  /** Global kill-switch for auto-reply. When false, messages still arrive in the UI but the AI stays silent. */
  aiEnabled: boolean;
}

const DEFAULT_CONFIG: BusinessConfig = {
  name: '',
  specialty: '',
  hours: '',
  closedDays: [],
  address: '',
  pixKey: '',
  products: [],
  catalogHierarchy: [],
  blockedDates: [],
  dailyContext: [],
  aiInstructions: '',
  managerPhone: '',
  aiEnabled: true,
};

// Keyed by empresaId — one config entry per authenticated empresa.
const configMap = new Map<string, BusinessConfig>();

export function getConfig(empresaId: string): BusinessConfig {
  return configMap.get(empresaId) ?? { ...DEFAULT_CONFIG };
}

export function setConfig(empresaId: string, c: Partial<BusinessConfig>): void {
  const existing = configMap.get(empresaId) ?? { ...DEFAULT_CONFIG };
  configMap.set(empresaId, { ...existing, ...c });
}
