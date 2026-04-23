export type ManagerActionType = 'BLOCK_DATE' | 'SET_PRODUCT_AVAILABILITY';

export interface BlockDatePayload {
  date: string;
  reason: string;
}

export interface SetAvailabilityPayload {
  name: string;
  available: boolean;
}

export interface ManagerActionItem {
  type: ManagerActionType;
  payload: BlockDatePayload | SetAvailabilityPayload;
}

export interface ManagerAgentResponse {
  reply: string;
  actions: ManagerActionItem[];
}
