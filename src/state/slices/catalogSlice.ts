import { Product, QuickResponse } from '../../types/catalog';

export interface CatalogState {
  products: Product[];
  quickResponses: QuickResponse[];
}

export type CatalogAction =
  | { type: 'catalog/setProductAvailability'; payload: { id: string; available: boolean } }
  | { type: 'catalog/addProduct'; payload: Product }
  | { type: 'catalog/updateProduct'; payload: Product }
  | { type: 'catalog/removeProduct'; payload: { id: string } }
  | { type: 'catalog/setQuickResponses'; payload: QuickResponse[] }
  | { type: 'catalog/addQuickResponse'; payload: QuickResponse }
  | { type: 'catalog/updateQuickResponse'; payload: QuickResponse }
  | { type: 'catalog/removeQuickResponse'; payload: { id: string } };

export function catalogReducer(state: CatalogState, action: CatalogAction): CatalogState {
  switch (action.type) {
    case 'catalog/setProductAvailability':
      return {
        ...state,
        products: state.products.map(p =>
          p.id === action.payload.id ? { ...p, available: action.payload.available } : p
        ),
      };
    case 'catalog/addProduct':
      return { ...state, products: [...state.products, action.payload] };
    case 'catalog/updateProduct':
      return {
        ...state,
        products: state.products.map(p => p.id === action.payload.id ? action.payload : p),
      };
    case 'catalog/removeProduct':
      return { ...state, products: state.products.filter(p => p.id !== action.payload.id) };
    case 'catalog/setQuickResponses':
      return { ...state, quickResponses: action.payload };
    case 'catalog/addQuickResponse':
      return { ...state, quickResponses: [...state.quickResponses, action.payload] };
    case 'catalog/updateQuickResponse':
      return {
        ...state,
        quickResponses: state.quickResponses.map(qr =>
          qr.id === action.payload.id ? action.payload : qr
        ),
      };
    case 'catalog/removeQuickResponse':
      return {
        ...state,
        quickResponses: state.quickResponses.filter(qr => qr.id !== action.payload.id),
      };
    default:
      return state;
  }
}
