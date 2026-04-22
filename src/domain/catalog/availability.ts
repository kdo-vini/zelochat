import { Product } from '../../types/catalog';

export function listAvailableProducts(products: Product[]): Product[] {
  return products.filter(p => p.available);
}

export function isProductAvailable(products: Product[], productName: string): boolean {
  const found = products.find(p => p.name.toLowerCase() === productName.toLowerCase());
  return found?.available ?? false;
}

export function formatProductsForPrompt(products: Product[]): string {
  return listAvailableProducts(products)
    .map(p => `${p.name} (R$ ${p.price.toFixed(2)})`)
    .join(', ');
}
