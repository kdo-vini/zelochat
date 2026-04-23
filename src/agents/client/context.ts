import { ZeloState } from '../../types/state';
import { ClientContext } from './types';

export function buildClientContext(state: ZeloState): ClientContext {
  return {
    products: state.products,
    blockedDates: state.blockedDates,
    dailyContext: state.dailyContext,
    alertTriggers: state.alertTriggers,
    aiInstructions: state.aiInstructions,
    businessInfo: state.businessInfo,
  };
}
