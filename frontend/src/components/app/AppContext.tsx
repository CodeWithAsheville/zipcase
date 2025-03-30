import React, { createContext, Dispatch, ReactNode, useReducer } from 'react';

interface AppContextType {
    token: string;
    dispatch: Dispatch<AppContextAction>;
}

const defaultContext = {
    token: '',
    dispatch: () => {},
};

export const AppContext = createContext<AppContextType>(defaultContext);

type AppContextAction = { type: 'SET_TOKEN'; payload: string };

const appReducer = (state: AppContextType, action: AppContextAction): AppContextType => {
    switch (action.type) {
        case 'SET_TOKEN':
            return { ...state, token: action.payload };
        default:
            return state;
    }
};

export const AppContextProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const initialState = {
        ...defaultContext,
    };

    const [state, dispatch] = useReducer(appReducer, initialState);

    return <AppContext.Provider value={{ ...state, dispatch }}>{children}</AppContext.Provider>;
};
