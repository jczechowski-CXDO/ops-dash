import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(<div data-testid="app-boot">ops-dash</div>);
