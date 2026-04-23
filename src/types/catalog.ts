export interface Product {
  id: string;
  name: string;
  price: number;
  available: boolean;
  category: 'salgado' | 'doce' | 'bebida';
}

export interface QuickResponse {
  id: string;
  trigger: string;
  response: string;
}
