import { useState, type CSSProperties, type ReactNode } from 'react';

// Ported from design_handoff_it_ops_dashboard/aurora/_ds_bundle.js lines 336-516.
// Dropped: startIcon/endIcon, fullWidth, size="large", variant="soft",
// color secondary/info, className/style/rest passthrough — the dashboard uses none
// of them. Every colour stays a var(--*) reference, exactly as the bundle has it.

type Size = 'small' | 'medium';
type Variant = 'contained' | 'outlined' | 'text';
type Color = 'primary' | 'success' | 'error' | 'warning' | 'neutral';

const SIZES: Record<Size, { height: number; padX: number; font: string; gap: number }> = {
  small: { height: 30, padX: 12, font: '0.8125rem', gap: 6 },
  medium: { height: 36, padX: 16, font: '0.875rem', gap: 8 },
};

const COLORS: Record<Color, { main: string; dark: string; contrast: string; border: string }> = {
  primary: {
    main: 'var(--primary-main)',
    dark: 'var(--primary-dark)',
    contrast: 'var(--primary-contrast)',
    border: 'var(--primary-states-outlinedborder)',
  },
  success: {
    main: 'var(--success-main)',
    dark: 'var(--success-dark)',
    contrast: 'var(--success-contrast)',
    border: 'var(--success-states-outlinedborder)',
  },
  error: {
    main: 'var(--error-main)',
    dark: 'var(--error-dark)',
    contrast: 'var(--error-contrast)',
    border: 'var(--error-states-outlinedborder)',
  },
  warning: {
    main: 'var(--warning-main)',
    dark: 'var(--warning-dark)',
    contrast: 'var(--warning-contrast)',
    border: 'var(--warning-states-outlinedborder)',
  },
  neutral: {
    main: 'var(--text-primary)',
    dark: 'var(--grey-grey-900)',
    contrast: 'var(--common-white)',
    border: 'var(--divider)',
  },
};

export function Button({
  variant = 'contained',
  color = 'primary',
  size = 'medium',
  disabled = false,
  onClick,
  children,
}: {
  variant?: Variant;
  color?: Color;
  size?: Size;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const s = SIZES[size];
  const c = COLORS[color];
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);

  const base: CSSProperties = {
    height: s.height,
    padding: `0 ${s.padX}px`,
    borderRadius: 'var(--radius-button)',
    fontFamily: 'var(--font-ui)',
    fontSize: s.font,
    fontWeight: 600,
    lineHeight: 1,
    letterSpacing: '0.01em',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s.gap,
    border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
    transition:
      'background var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)',
    transform: active && !disabled ? 'scale(0.98)' : 'scale(1)',
    userSelect: 'none',
    boxSizing: 'border-box',
  };

  if (variant === 'contained') {
    base.background = hover ? c.dark : c.main;
    base.color = c.contrast;
    base.boxShadow = hover ? 'var(--shadow-sm)' : 'var(--shadow-xs)';
  } else if (variant === 'outlined') {
    base.background = hover ? `color-mix(in srgb, ${c.main} 8%, transparent)` : 'transparent';
    base.color = c.main;
    base.borderColor = hover ? c.main : c.border;
  } else {
    base.background = hover ? `color-mix(in srgb, ${c.main} 8%, transparent)` : 'transparent';
    base.color = c.main;
  }

  if (disabled) {
    base.background = variant === 'contained' ? 'var(--action-disabledbackground)' : 'transparent';
    base.color = 'var(--text-disabled)';
    base.borderColor = variant === 'outlined' ? 'var(--action-disabledbackground)' : 'transparent';
    base.boxShadow = 'none';
    base.opacity = variant === 'contained' ? 1 : 0.7;
  }

  return (
    <button
      type="button"
      disabled={disabled}
      className="aur-button"
      style={base}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
    >
      {children}
    </button>
  );
}
