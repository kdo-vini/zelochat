export interface ManagerAction {
  type: 'BLOCK_DATE' | 'SET_PRODUCT_AVAILABILITY';
  payload: Record<string, unknown>;
}

export interface ManagerResponse {
  reply: string;
  actions: ManagerAction[];
}
