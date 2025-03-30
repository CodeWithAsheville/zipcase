import { StrictMode } from 'react';
import { App } from './components';
import './index.css';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
);
