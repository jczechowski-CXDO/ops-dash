import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

/**
 * The card recipe from README "Card recipe used everywhere", in one place so no
 * view re-types it: 1px solid var(--divider), radius 12, background
 * var(--background-paper), padding 14-18px.
 */
export function Card({
  children,
  padding = '16px 18px',
  borderLeft,
  style,
  onClick,
  'data-testid': testId,
}: {
  children: ReactNode;
  padding?: string;
  borderLeft?: string;
  style?: CSSProperties;
  onClick?: () => void;
  /**
   * Hangs the hook on the card itself. Without it a caller must wrap the Card in
   * a <div>, which makes the WRAPPER the grid item and the Card its child — so
   * minmax(), gap and height apply to a box the Card does not control. Pixel
   * identical is not structurally identical, and Task 10A photographs structure.
   */
  'data-testid'?: string;
}) {
  // M-6: a clickable card is an interactive control and must be reachable and
  // operable without a mouse. It stays a <div> rather than a <button> because
  // cards nest headings, tables and their own buttons, none of which is legal
  // inside a <button>; so it takes the button role, tab order and key handling
  // explicitly. A non-clickable card gets none of these and stays inert.
  const interactive = Boolean(onClick);

  // Spread conditionally rather than `data-testid={testId}`. On this DOM element
  // the two are equivalent — React omits an attribute whose value is undefined,
  // verified, and a mutation to the direct form survives the suite. It is
  // written this way for consistency with StatCard, where forwarding the same
  // prop to a TYPED component is not equivalent: under exactOptionalPropertyTypes
  // the direct form is TS2375, because an optional prop must be absent rather
  // than explicitly undefined.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    // Enter and Space are what a native button honours; match it exactly.
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); // Space would otherwise scroll the page
    onClick();
  };

  return (
    <div
      {...(interactive
        ? { onClick, onKeyDown, role: 'button' as const, tabIndex: 0 }
        : {})}
      {...(testId === undefined ? {} : { 'data-testid': testId })}
      style={{
        border: '1px solid var(--divider)',
        ...(borderLeft ? { borderLeft: `3px solid ${borderLeft}` } : {}),
        borderRadius: 12,
        background: 'var(--background-paper)',
        padding,
        ...(interactive ? { cursor: 'pointer' } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
