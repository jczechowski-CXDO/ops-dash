import type { ReactNode } from 'react';
import { Alert } from './aurora/Alert.js';
import { Skeleton } from './aurora/Skeleton.js';

/**
 * The per-source states the prototype does not cover and README "What the
 * prototype does not cover" says must be added. A panel that cannot say "this
 * number is 40 minutes old" is a panel that lies quietly.
 */
export type PanelState =
  | { kind: 'ready' }
  | { kind: 'loading'; rows?: number }
  | { kind: 'empty'; message: string }
  | { kind: 'stale'; source: string; fetchedAt: string }
  | { kind: 'error'; source: string; message: string; fetchedAt?: string };

// Intl.RelativeTimeFormat is a built-in. No date library is in the budget.
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

export function ageLabel(iso: string, now: number = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return rtf.format(-minutes, 'minute').replace(' ago', '');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour').replace(' ago', '');
  return rtf.format(-Math.round(hours / 24), 'day').replace(' ago', '');
}

export function Panel({ state, children }: { state: PanelState; children: ReactNode }) {
  switch (state.kind) {
    case 'loading':
      return <Skeleton variant="text" lines={state.rows ?? 4} />;

    // No children. An error with nothing cached must not render a zero that
    // reads as a measurement.
    case 'error':
      return (
        <Alert severity="error" title={`${state.source} is unavailable`}>
          {state.message}
          {state.fetchedAt ? ` · last good data ${ageLabel(state.fetchedAt)} old` : ''}
        </Alert>
      );

    case 'empty':
      return (
        <div
          style={{
            padding: '28px 24px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--text-secondary)',
          }}
        >
          {state.message}
        </div>
      );

    // Stale DOES render its children — the last good data is still the best
    // answer available — but never without saying how old it is.
    case 'stale':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Alert severity="warning">{`${state.source} data is ${ageLabel(state.fetchedAt)} old`}</Alert>
          {children}
        </div>
      );

    case 'ready':
      return <>{children}</>;
  }
}
