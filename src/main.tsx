import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';
import { applyResolved, readStoredTheme, resolveTheme } from './theme';

// before first paint, so a dark session never flashes the light palette
applyResolved(resolveTheme(readStoredTheme()));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
