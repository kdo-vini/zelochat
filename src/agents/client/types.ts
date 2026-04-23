import { Product } from '../../types/catalog';
import { BlockedDate, BusinessInfo } from '../../types/calendar';
import { AlertTrigger } from '../../types/alerts';

export interface ClientContext {
  products: Product[];
  blockedDates: BlockedDate[];
  dailyContext: { id: string; text: string }[];
  alertTriggers: AlertTrigger[];
  aiInstructions: string;
  businessInfo: BusinessInfo;
}
