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
}: {
  children: ReactNode;
  padding?: string;
  borderLeft?: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  // M-6: a clickable card is an interactive control and must be reachable and
  // operable without a mouse. It stays a <div> rather than a <button> because
  // cards nest headings, tables and their own buttons, none of which is legal
  // inside a <button>; so it takes the button role, tab order and key handling
  // explicitly. A non-clickable card gets none of these and stays inert.
  const interactive = Boolean(onClick);

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
