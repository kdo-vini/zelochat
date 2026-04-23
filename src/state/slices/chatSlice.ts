import { ChatSession, ChatMessage } from '../../types/chat';

export interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string;
}

export type ChatAction =
  | { type: 'chat/setActiveSession'; payload: string }
  | { type: 'chat/addMessage'; payload: { sessionId: string; message: ChatMessage } }
  | { type: 'chat/addSession'; payload: ChatSession }
  | { type: 'chat/archiveSession'; payload: { sessionId: string } }
  | { type: 'chat/markRead'; payload: { sessionId: string } }
  | { type: 'chat/addAlerts'; payload: { sessionId: string; alertIds: string[] } };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'chat/setActiveSession':
      return { ...state, activeSessionId: action.payload };
    case 'chat/addMessage':
      return {
        ...state,
        sessions: state.sessions.map(s => {
          if (s.id !== action.payload.sessionId) return s;
          return {
            ...s,
            messages: [...s.messages, action.payload.message],
            lastMessage: action.payload.message.content,
            lastMessageTime: action.payload.message.timestamp,
          };
        }),
      };
    case 'chat/addSession':
      return { ...state, sessions: [...state.sessions, action.payload] };
    case 'chat/archiveSession':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id === action.payload.sessionId ? { ...s, status: 'archived' as const } : s
        ),
      };
    case 'chat/markRead':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id === action.payload.sessionId ? { ...s, unreadCount: 0 } : s
        ),
      };
    case 'chat/addAlerts':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id === action.payload.sessionId
            ? { ...s, alerts: [...(s.alerts || []), ...action.payload.alertIds] }
            : s
        ),
      };
    default:
      return state;
  }
}
