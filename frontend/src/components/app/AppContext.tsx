import { createContext, Dispatch } from 'react';

export interface AppContextType {
    token: string;
    firstTimeUser: boolean;
    dispatch: Dispatch<AppContextAction>;
}

export const defaultContext = {
    token: '',
    firstTimeUser: false,
    dispatch: () => {},
};

export const AppContext = createContext<AppContextType>(defaultContext);

export type AppContextAction =
    | { type: 'SET_TOKEN'; payload: string }
    | { type: 'SET_FIRST_TIME_USER'; payload: boolean };

export const appReducer = (state: AppContextType, action: AppContextAction): AppContextType => {
    switch (action.type) {
        case 'SET_TOKEN':
            return { ...state, token: action.payload };
        case 'SET_FIRST_TIME_USER':
            return { ...state, firstTimeUser: action.payload };
        default:
            return state;
    }
};
