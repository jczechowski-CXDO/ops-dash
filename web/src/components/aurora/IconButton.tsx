import { useState, type ReactNode } from 'react';

// Ported from _ds_bundle.js lines 1066-1159. Dropped: color (the dashboard only
// ever uses the neutral tint), size (medium only), variant (standard only),
// shape (circular only), className/style/rest passthrough.

const BOX = 38;
const TINT = 'var(--text-secondary)';

export function IconButton({
  onClick,
  disabled = false,
  children,
  'aria-label': ariaLabel,
}: {
  onClick?: () => void;
  'aria-label': string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      className="aur-icon-button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: BOX,
        height: BOX,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        borderRadius: 'var(--radius-circle)',
        border: '1px solid transparent',
        background:
          disabled || !hover ? 'transparent' : `color-mix(in srgb, ${TINT} 10%, transparent)`,
        color: disabled ? 'var(--text-disabled)' : TINT,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition:
          'background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard)',
        padding: 0,
        boxSizing: 'border-box',
      }}
    >
      {children}
    </button>
  );
}
