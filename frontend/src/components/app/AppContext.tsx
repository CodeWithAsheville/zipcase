import { createContext, Dispatch } from 'react';

export interface AppContextType {
    token: string;
    dispatch: Dispatch<AppContextAction>;
}

export const defaultContext = {
    token: '',
    dispatch: () => {},
};

export const AppContext = createContext<AppContextType>(defaultContext);

export type AppContextAction = { type: 'SET_TOKEN'; payload: string };

export const appReducer = (state: AppContextType, action: AppContextAction): AppContextType => {
    switch (action.type) {
        case 'SET_TOKEN':
            return { ...state, token: action.payload };
        default:
            return state;
    }
};