export interface BlockedDate {
  date: string;   // YYYY-MM-DD
  reason: string;
}

export interface BusinessInfo {
  name: string;
  hours: string;
  closedDays: string[];
  specialty: string;
  address: string;
  phone: string;
  pixKey: string;
}
