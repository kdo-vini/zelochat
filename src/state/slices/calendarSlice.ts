import { BlockedDate, BusinessInfo } from '../../types/calendar';

export interface CalendarState {
  blockedDates: BlockedDate[];
  businessInfo: BusinessInfo;
}

export type CalendarAction =
  | { type: 'calendar/addBlockedDate'; payload: BlockedDate }
  | { type: 'calendar/removeBlockedDate'; payload: { date: string } }
  | { type: 'calendar/setBusinessInfo'; payload: Partial<BusinessInfo> };

export function calendarReducer(state: CalendarState, action: CalendarAction): CalendarState {
  switch (action.type) {
    case 'calendar/addBlockedDate':
      return { ...state, blockedDates: [...state.blockedDates, action.payload] };
    case 'calendar/removeBlockedDate':
      return {
        ...state,
        blockedDates: state.blockedDates.filter(bd => bd.date !== action.payload.date),
      };
    case 'calendar/setBusinessInfo':
      return { ...state, businessInfo: { ...state.businessInfo, ...action.payload } };
    default:
      return state;
  }
}
