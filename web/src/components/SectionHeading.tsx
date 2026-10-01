import type { ReactNode } from 'react';

export function SectionHeading({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15 }}>
        {children}
      </h2>
      {meta ? <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{meta}</div> : null}
    </div>
  );
}
