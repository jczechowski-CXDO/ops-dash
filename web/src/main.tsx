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
      {/* The router is OUTSIDE the demo-mode provider, which the plan had the
          other way round: the provider reads ?demo= through useSearchParams and
          needs router context to do it. */}
      <BrowserRouter>
        <DemoModeProvider>
          <App />
        </DemoModeProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
