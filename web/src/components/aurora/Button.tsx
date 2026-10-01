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

const COLORS: Record<Color, { text: string; hover: string; contrast: string; border: string }> = {
  primary: {
    text: 'var(--primary-dark)',
    hover: 'var(--primary-darker)',
    contrast: 'var(--primary-contrast)',
    border: 'var(--primary-states-outlinedborder)',
  },
  success: {
    text: 'var(--success-dark)',
    hover: 'var(--success-darker)',
    contrast: 'var(--success-contrast)',
    border: 'var(--success-states-outlinedborder)',
  },
  error: {
    text: 'var(--error-dark)',
    hover: 'var(--error-darker)',
    contrast: 'var(--error-contrast)',
    border: 'var(--error-states-outlinedborder)',
  },
  warning: {
    text: 'var(--warning-dark)',
    hover: 'var(--warning-darker)',
    contrast: 'var(--warning-contrast)',
    border: 'var(--warning-states-outlinedborder)',
  },
  // G3 re-verification: a Button label is TEXT, so every foreground here is the
  // -dark rung, not -main. The bundle's -main is decoration grade: as an
  // outlined/text label on light paper it measures success 3.40, warning 2.40,
  // primary 4.35 — all under the 4.5 bar. `-dark` and `-darker` are both
  // theme-aware and lighten in the dark palette, so the fix holds in both.
  // Contained fills with -dark rather than -main for the same reason: white on
  // --warning-main is 2.40.
  //
  // HIGH-1. The bundle maps neutral to text-primary / grey-900 / common-white,
  // mixing three unrelated families. In the dark palette that puts
  // rgb(235,242,245) behind rgb(255,255,255) — 1.13:1, an invisible label that
  // reappears only on hover, because grey-900 happens to be dark in both themes.
  // Aurora already ships a theme-aware neutral family and the bundle simply does
  // not use it. Using it resolves to 16.28:1 / 18.48:1 in light and
  // 13.05:1 / 15.79:1 in dark, at rest and on hover.
  neutral: {
    text: 'var(--neutral-dark)',
    hover: 'var(--neutral-darker)',
    contrast: 'var(--neutral-contrast)',
    border: 'var(--neutral-states-outlinedborder)',
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
    base.background = hover ? c.hover : c.text;
    base.color = c.contrast;
    base.boxShadow = hover ? 'var(--shadow-sm)' : 'var(--shadow-xs)';
  } else if (variant === 'outlined') {
    base.background = hover ? `color-mix(in srgb, ${c.text} 8%, transparent)` : 'transparent';
    base.color = c.text;
    base.borderColor = hover ? c.text : c.border;
  } else {
    base.background = hover ? `color-mix(in srgb, ${c.text} 8%, transparent)` : 'transparent';
    base.color = c.text;
  }

  if (disabled) {
    base.background = variant === 'contained' ? 'var(--action-disabledbackground)' : 'transparent';
    // --text-disabled is 2.29:1 light / 2.78:1 dark and fails AA as text.
    // WCAG exempts disabled CONTROLS, but our disabled buttons are not all
    // affordances: "Acknowledged" is a completed STATE the operator is meant to
    // read. Judged as content, it has to be legible, so this is --text-secondary
    // (7.23 / 8.75 on paper, 5.69 / 6.10 on the disabled fill). It still reads as
    // unavailable — de-emphasised colour, flat fill, not-allowed cursor — it just
    // does not vanish.
    base.color = 'var(--text-secondary)';
    base.borderColor = variant === 'outlined' ? 'var(--action-disabledbackground)' : 'transparent';
    base.boxShadow = 'none';
    // No opacity multiplier: it would scale the contrast back down again.
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
