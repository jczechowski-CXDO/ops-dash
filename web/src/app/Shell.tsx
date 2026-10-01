import type { ReactNode } from 'react';
import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';

/** The frame every view hangs in. It holds no view state of its own: the
 *  sidebar reads the fixture bundle, the header reads the location, and
 *  everything else lives inside the routed view, which unmounts on navigation. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--background-default)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Header />
        <main style={{ flex: 1, padding: '20px 24px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
