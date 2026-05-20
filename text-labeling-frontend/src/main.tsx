// src/main.tsx

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Toast';
import { initializeUiTheme } from './utils/theme';
import './index.css';

initializeUiTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>
);
