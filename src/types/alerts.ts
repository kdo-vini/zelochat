export interface AlertTrigger {
  id: string;
  name: string;
  active: boolean;
}

export interface ParsedAlerts {
  cleanText: string;
  alertIds: string[];
}
