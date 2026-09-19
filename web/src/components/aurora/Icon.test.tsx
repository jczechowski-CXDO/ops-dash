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

describe('Icon is not an injection point', () => {
  it('a caller cannot replace the glyph body via prop spread', () => {
    // Regression for G0 finding H-1. Before the fix, {...rest} was spread AFTER
    // dangerouslySetInnerHTML, so this rendered <image href="x" onerror="1">.
    // The cast is the point of the test: it proves the runtime is safe even when
    // the type-level Omit is defeated, which is what `<Icon {...someProps} />`
    // in a view would do. The repository guard cannot catch that — it greps for
    // the literal string and a spread does not contain it.
    const hostile = {
      dangerouslySetInnerHTML: { __html: '<image href="x" onerror="1">' },
    } as unknown as { 'aria-label'?: string };
    const { container } = render(<Icon name="shield" {...hostile} />);
    const svg = container.querySelector('svg');
    expect(svg?.innerHTML).toContain('<path');
    expect(svg?.innerHTML).not.toContain('<image');
    expect(svg?.innerHTML).not.toContain('onerror');
  });
});
