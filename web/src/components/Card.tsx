import type { CSSProperties, ReactNode } from 'react';

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
  return (
    <div
      onClick={onClick}
      style={{
        border: '1px solid var(--divider)',
        ...(borderLeft ? { borderLeft: `3px solid ${borderLeft}` } : {}),
        borderRadius: 12,
        background: 'var(--background-paper)',
        padding,
        ...(onClick ? { cursor: 'pointer' } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
