import React, { ReactNode, useReducer } from 'react';
import { AppContext, defaultContext, appReducer } from './AppContext';

export { AppContext } from './AppContext';

export const AppContextProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const initialState = {
        ...defaultContext,
    };

    const [state, dispatch] = useReducer(appReducer, initialState);

    return <AppContext.Provider value={{ ...state, dispatch }}>{children}</AppContext.Provider>;
};
