import type { CSSProperties, SVGProps } from 'react';
import { ICONS, type IconName } from './icons.generated.js';

export type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
} & Omit<SVGProps<SVGSVGElement>, 'name' | 'color' | 'style' | 'className'>;

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
      // Build-time-generated geometry from the vendored Aurora bundle. No user input.
      dangerouslySetInnerHTML={{ __html: glyph.body }}
      {...rest}
    />
  );
}
