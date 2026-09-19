import type { CSSProperties } from 'react';

/**
 * Visually hidden, still announced. Use for text that exists only for assistive
 * technology — a severity word on an Alert, "Loading" on a busy Panel.
 *
 * A plain style object, deliberately. There is no stylesheet under web/src to
 * hold an .sr-only class and there should not be one (accepted finding 3), so
 * this is the shared form: `<span style={srOnly}>Loading</span>`.
 *
 * Not `display: none` and not `visibility: hidden` — both remove the element
 * from the accessibility tree, which is the opposite of the point. The
 * clip-path-plus-1px idiom keeps it rendered and readable by a screen reader.
 */
export const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};
