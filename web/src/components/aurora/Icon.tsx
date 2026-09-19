import type { CSSProperties, SVGProps } from 'react';
import { ICONS, type IconName } from './icons.generated.js';

export type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
} & Omit<
  SVGProps<SVGSVGElement>,
  // dangerouslySetInnerHTML is omitted deliberately: this component is the ONLY
  // sanctioned HTML sink in the app, and a caller that could pass it would turn
  // <Icon {...props} /> into an arbitrary-markup injection point. The repository
  // guard greps for the literal string, so such a call site would pass unnoticed.
  'name' | 'color' | 'style' | 'className' | 'dangerouslySetInnerHTML'
>;

export function Icon({
  name,
  size = 24,
  color = 'currentColor',
  className = '',
  style,
  ...rest
}: IconProps) {
  const glyph = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox={glyph.viewBox}
      fill="none"
      className={`aur-icon ${className}`}
      aria-hidden={rest['aria-label'] ? undefined : true}
      style={{ display: 'inline-block', flexShrink: 0, color, verticalAlign: 'middle', ...style }}
      {...rest}
      // Build-time-generated geometry from the vendored Aurora bundle. No user input.
      // MUST stay below {...rest}: JSX spread is last-wins, so with this above it a
      // caller could replace the glyph body with arbitrary markup.
      dangerouslySetInnerHTML={{ __html: glyph.body }}
    />
  );
}
