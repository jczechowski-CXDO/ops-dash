import type { ReactNode } from 'react';
import { Alert } from './aurora/Alert.js';
import { Skeleton } from './aurora/Skeleton.js';
import { agePhrase } from '../theme/ago.js';
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
  /**
   * `reason` is WHY the data is stale, in the failure's own words — "the feed
   * returned 503". An age with no cause is half the message: it tells an
   * operator to refresh when what they need to do is look at Zendesk. Optional
   * because plenty of stale states have no sentence to offer, and because the
   * fixture path has none; absent, this renders exactly as it did before.
   */
  | { kind: 'stale'; source: string; fetchedAt: string; reason?: string }
  | { kind: 'error'; source: string; message: string; fetchedAt?: string };

function unreachable(state: never): never {
  throw new Error(`Panel: unhandled state ${JSON.stringify(state)}`);
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
    case 'stale': {
      const age = `${state.source} data is ${agePhrase(state.fetchedAt)}`;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* The reason goes INSIDE the alert rather than beside it. Outside,
              it sits outside `role="alert"`, so a screen reader hears the age
              announced and never hears the cause — the same half-message, for a
              different user. Alert's own title/body split carries both: the age
              is the headline, the reason the detail, one announcement. */}
          {state.reason === undefined ? (
            <Alert severity="warning">{age}</Alert>
          ) : (
            <Alert severity="warning" title={age}>
              <span data-testid="panel-stale-reason">{state.reason}</span>
            </Alert>
          )}
          {children}
        </div>
      );
    }

    case 'ready':
      return <>{children}</>;

    // M-1: without this a new PanelState member compiles clean and renders blank.
    default:
      return unreachable(state);
  }
}
