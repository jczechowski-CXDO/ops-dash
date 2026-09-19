import type { ReactNode } from 'react';
import { Alert } from './aurora/Alert.js';
import { Skeleton } from './aurora/Skeleton.js';
import { ageLabel, UNKNOWN_AGE } from '../theme/ageLabel.js';
import { srOnly } from '../theme/srOnly.js';

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

function unreachable(state: never): never {
  throw new Error(`Panel: unhandled state ${JSON.stringify(state)}`);
}

/** '14 minutes old' / 'of unknown age' — never 'an unknown age old'. */
function agePhrase(iso: string): string {
  const age = ageLabel(iso);
  return age === UNKNOWN_AGE ? 'of unknown age' : `${age} old`;
}

export function Panel({ state, children }: { state: PanelState; children: ReactNode }) {
  switch (state.kind) {
    // The Skeleton itself stays decorative (aria-hidden). The fact that a panel
    // is loading is a property of the panel, not of the grey boxes, so the live
    // region lives here: without it a screen reader hears silence and then, some
    // seconds later, content appearing with no explanation.
    case 'loading':
      return (
        <div role="status" aria-busy="true" aria-live="polite">
          <span style={srOnly}>Loading</span>
          <Skeleton variant="text" lines={state.rows ?? 4} />
        </div>
      );

    // No children. An error with nothing cached must not render a zero that
    // reads as a measurement.
    case 'error':
      return (
        <Alert severity="error" title={`${state.source} is unavailable`}>
          {state.message}
          {state.fetchedAt ? ` · last good data ${agePhrase(state.fetchedAt)}` : ''}
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
          <Alert severity="warning">{`${state.source} data is ${agePhrase(state.fetchedAt)}`}</Alert>
          {children}
        </div>
      );

    case 'ready':
      return <>{children}</>;

    // M-1: without this a new PanelState member compiles clean and renders blank.
    default:
      return unreachable(state);
  }
}
