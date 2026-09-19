import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Icon } from './Icon.js';

describe('Icon', () => {
  it('renders the requested glyph as inline svg at the requested size', () => {
    const { container } = render(<Icon name="shield" size={19} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '19');
    expect(svg).toHaveAttribute('height', '19');
    expect(svg).toHaveAttribute('viewBox', '0 0 48 48');
    expect(svg?.innerHTML).toContain('<path');
  });

  it('defaults to currentColor and honours an explicit colour token', () => {
    const { container } = render(<Icon name="monitoring" size={17} color="var(--primary-main)" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('style')).toContain('var(--primary-main)');
  });

  it('is aria-hidden unless given a label', () => {
    const { container, rerender } = render(<Icon name="mail" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Icon name="mail" aria-label="Email security" />);
    expect(container.querySelector('svg')).not.toHaveAttribute('aria-hidden');
  });
});
