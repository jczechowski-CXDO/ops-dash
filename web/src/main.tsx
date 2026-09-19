import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ThemeProvider } from './theme/ThemeProvider.js';
import { DemoModeProvider } from './app/DemoModeProvider.js';
import { App } from './app/App.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <DemoModeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </DemoModeProvider>
    </ThemeProvider>
  </StrictMode>,
);
