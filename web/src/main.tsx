import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ThemeProvider } from './theme/ThemeProvider.js';
import { DemoModeProvider } from './app/DemoModeProvider.js';
import { App } from './app/App.js';
import { DataSourceSwitch } from './live/DataSourceSwitch.js';

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
          {/* The ONE place the app decides between the API and the fixtures.
              Inside the router because it reads `?demo=`; outside `App` so that
              every test which renders `<App/>` keeps the offline path with no
              change to the test. */}
          <DataSourceSwitch>
            <App />
          </DataSourceSwitch>
        </DemoModeProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
