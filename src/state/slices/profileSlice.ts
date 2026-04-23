export interface ProfileState {
  name: string;
  email: string;
  role: string;
  avatar: string;
  notifications: boolean;
  darkMode: boolean;
}

export type ProfileAction =
  | { type: 'profile/update'; payload: Partial<ProfileState> };

export function profileReducer(state: ProfileState, action: ProfileAction): ProfileState {
  switch (action.type) {
    case 'profile/update':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}
