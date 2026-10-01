// Ported from _ds_bundle.js lines 4790-4895 (medium size, primary tint).
//
// One deliberate deviation, sanctioned by Task 4 Step 7: the bundle builds the
// control from a visually hidden <input type="checkbox"> inside a <label>, and
// exposes onChange(event). This version renders a real <button role="switch"
// aria-checked> and calls onChange(next) with the value, not the event. It
// changes no pixels — the track and knob spans are the bundle's, unaltered.
//
// The knob fill keeps the bundle's `var(--switch-knobfill, ...)` reference; the
// bundle's literal white fallback is replaced by the equivalent token
// `var(--common-white)`, which resolves to the same colour. No hex enters
// web/src, and this is not one of the three places the allowlist marker covers.

const W = 42;
const H = 24;
const KNOB = 18;
const PAD = (H - KNOB) / 2;

export function Switch({
  checked,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  'aria-label': string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className="aur-switch"
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      style={{
        position: 'relative',
        width: W,
        height: H,
        flexShrink: 0,
        padding: 0,
        border: 'none',
        borderRadius: 999,
        background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        fontFamily: 'var(--font-ui)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 999,
          background: checked
            ? 'var(--primary-main)'
            : 'var(--switch-slidefill, var(--grey-grey-300))',
          transition: 'background var(--dur-base) var(--ease-standard)',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: PAD,
          left: checked ? W - KNOB - PAD : PAD,
          width: KNOB,
          height: KNOB,
          borderRadius: '50%',
          background: 'var(--switch-knobfill, var(--common-white))',
          boxShadow: 'var(--shadow-sm)',
          transition: 'left var(--dur-base) var(--ease-standard)',
        }}
      />
    </button>
  );
}
