import { describe, it, expect, vi } from 'vitest';
import { Table } from './aurora/Table.js';
import { render, screen, fireEvent } from '@testing-library/react';
import { Card } from './Card.js';
import { StatCard } from './StatCard.js';
import { Sparkline } from './Sparkline.js';
import { Panel } from './Panel.js';
import { SectionHeading } from './SectionHeading.js';

describe('Card', () => {
  it('applies the card recipe from README "Card recipe used everywhere"', () => {
    const { container } = render(<Card>body</Card>);
    expect(container.firstElementChild).toHaveStyle({
      border: '1px solid var(--divider)',
      borderRadius: '12px',
      background: 'var(--background-paper)',
    });
  });

  it('takes an accent border on the left when asked', () => {
    const { container } = render(<Card borderLeft="var(--error-main)">body</Card>);
    expect(container.firstElementChild).toHaveStyle({ borderLeft: '3px solid var(--error-main)' });
  });
});

describe('Card', () => {
  it('a clickable card is operable by keyboard, not mouse only', () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick}>tile</Card>);
    const card = screen.getByRole('button', { name: 'tile' });
    expect(card).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('hangs a test hook on the card itself, so no wrapper div becomes the grid item', () => {
    // w3-overview was wrapping Card in a <div> to carry this. Under
    // grid-template-columns: repeat(auto-fill, minmax(190px,1fr)) the wrapper
    // becomes the grid item and the Card its child, so minmax/gap/height apply
    // to a box the Card does not control.
    const { container } = render(<Card data-testid="service-tile">tile</Card>);
    const hooked = screen.getByTestId('service-tile');
    expect(hooked).toBe(container.firstElementChild);
    expect(hooked).toHaveStyle({ borderRadius: '12px' }); // the card itself, not a wrapper
  });

  it('emits no test hook attribute at all when none is given', () => {
    // exactOptionalPropertyTypes makes an explicit undefined a type error; this
    // pins the runtime half, so the prop is absent rather than "undefined".
    const { container } = render(<Card>plain</Card>);
    expect(container.firstElementChild!.hasAttribute('data-testid')).toBe(false);
  });

  it('a non-clickable card is not announced as a control and is not focusable', () => {
    render(<Card>plain</Card>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('plain')).not.toHaveAttribute('tabindex');
  });
});

describe('StatCard', () => {
  it('renders label, value and note', () => {
    render(<StatCard label="MFA coverage" value="94.3%" note="29 users unregistered" />);
    expect(screen.getByText('MFA coverage')).toBeInTheDocument();
    expect(screen.getByText('94.3%')).toBeInTheDocument();
    expect(screen.getByText('29 users unregistered')).toBeInTheDocument();
  });

  it('renders a progress bar instead of a note when given one', () => {
    render(<StatCard label="Patch compliance" value="91.4%" progress={{ value: 91, color: 'warning' }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '91');
  });

  it('forwards its test hook to the card root rather than an inner element', () => {
    render(<StatCard data-testid="mfa-stat" label="MFA coverage" value="94.3%" />);
    const hooked = screen.getByTestId('mfa-stat');
    expect(hooked).toHaveStyle({ borderRadius: '12px' });
    expect(hooked).toHaveTextContent('MFA coverage');
    expect(hooked).toHaveTextContent('94.3%');
  });

  it('renders values with tabular numerals', () => {
    render(<StatCard label="Blocked" value="3,911" />);
    expect(screen.getByText('3,911')).toHaveStyle({ fontVariantNumeric: 'tabular-nums' });
  });
});

describe('Sparkline', () => {
  it('emits 28 points across the viewBox width, oldest first', () => {
    const values = Array.from({ length: 28 }, (_, i) => 100 + i);
    const { container } = render(<Sparkline values={values} color="var(--success-main)" height={26} viewBoxHeight={26} />);
    const points = container.querySelector('polyline')?.getAttribute('points')?.split(' ') ?? [];
    expect(points).toHaveLength(28);
    expect(points[0]?.split(',')[0]).toBe('0.0');
    expect(points[27]?.split(',')[0]).toBe('100.0');
  });

  it('puts the highest latency highest on the chart', () => {
    const { container } = render(<Sparkline values={[100, 900]} color="var(--error-main)" height={26} viewBoxHeight={26} />);
    const [lo, hi] = (container.querySelector('polyline')?.getAttribute('points') ?? '').split(' ');
    expect(Number(hi?.split(',')[1])).toBeLessThan(Number(lo?.split(',')[1])); // smaller y = higher up
  });

  it('draws a flat mid-line when every sample is identical', () => {
    const { container } = render(<Sparkline values={[200, 200, 200]} color="var(--success-main)" height={26} viewBoxHeight={26} />);
    const ys = (container.querySelector('polyline')?.getAttribute('points') ?? '').split(' ').map((p) => p.split(',')[1]);
    expect(new Set(ys).size).toBe(1);
  });

  it('never renders a pre-baked point string handed in as data', () => {
    const { container } = render(<Sparkline values={[]} color="var(--success-main)" height={26} viewBoxHeight={26} />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});

describe('Panel', () => {
  it('renders children when ready', () => {
    render(<Panel state={{ kind: 'ready' }}><p>real data</p></Panel>);
    expect(screen.getByText('real data')).toBeInTheDocument();
  });

  it('hides children behind a skeleton while loading', () => {
    render(<Panel state={{ kind: 'loading', rows: 3 }}><p>real data</p></Panel>);
    expect(screen.queryByText('real data')).not.toBeInTheDocument();
  });

  it('shows the age of the data and still renders it when stale', () => {
    const fourteenMinutesAgo = new Date(Date.now() - 14 * 60_000).toISOString();
    render(<Panel state={{ kind: 'stale', source: 'Endpoint Central', fetchedAt: fourteenMinutesAgo }}><p>last good</p></Panel>);
    expect(screen.getByRole('alert')).toHaveTextContent(/Endpoint Central data is 14 minutes (old|stale)/);
    expect(screen.getByText('last good')).toBeInTheDocument();
  });

  it('never renders children as if real when the fetch failed with nothing cached', () => {
    render(<Panel state={{ kind: 'error', source: 'Microsoft Graph', message: 'consent required' }}><p>0</p></Panel>);
    expect(screen.getByRole('alert')).toHaveTextContent('Microsoft Graph');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('distinguishes empty from healthy', () => {
    render(<Panel state={{ kind: 'empty', message: 'No incidents published' }}><p>rows</p></Panel>);
    expect(screen.getByText('No incidents published')).toBeInTheDocument();
    expect(screen.queryByText('rows')).not.toBeInTheDocument();
  });

  it('announces that it is loading rather than going silent', () => {
    render(<Panel state={{ kind: 'loading' }}><p>real data</p></Panel>);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Loading');
  });

  it('never phrases an unparseable timestamp as an age', () => {
    render(<Panel state={{ kind: 'stale', source: 'Endpoint Central', fetchedAt: 'garbage' }}><p>x</p></Panel>);
    expect(screen.getByRole('alert')).toHaveTextContent('Endpoint Central data is of unknown age');
    expect(screen.getByRole('alert')).not.toHaveTextContent('an unknown age old');
  });

  it('reports the age of the last good data on an error that has some', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    render(
      <Panel state={{ kind: 'error', source: 'Microsoft Graph', message: 'consent required', fetchedAt: twoHoursAgo }}>
        <p>0</p>
      </Panel>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('2 hours');
  });
});

describe('SectionHeading', () => {
  it('renders a heading with optional meta', () => {
    render(<SectionHeading meta="4 open · 1 Sev1">Active incidents</SectionHeading>);
    expect(screen.getByRole('heading', { name: 'Active incidents' })).toBeInTheDocument();
    expect(screen.getByText('4 open · 1 Sev1')).toBeInTheDocument();
  });
});

describe('Column.truncate (G3½ HIGH — the Email table was clipped at 1000px)', () => {
  // README § Tables: columns are capped so "the last column survives a ~1000px
  // content well". Email's free-text Subject pushed REASON past the card border
  // and it was clipped mid-word — "Credential phishi…" — which the 1000px
  // baselines recorded. A column that yields with an ellipsis is the fix, and
  // it has to be opt-in: making every cell truncate would collapse the short
  // columns that are meant to hold their width.
  type Row = { a: string; b: string };
  const rows: Row[] = [{ a: 'x'.repeat(200), b: 'REASON' }];

  it('gives up width with an ellipsis, and only on the column that asked', () => {
    const { container } = render(
      <Table<Row>
        columns={[
          { key: 'a', label: 'A', truncate: true },
          { key: 'b', label: 'B' },
        ]}
        rows={rows}
      />,
    );
    const [truncating, holding] = [...container.querySelectorAll('tbody td')];
    expect(truncating).toHaveStyle({ textOverflow: 'ellipsis', overflow: 'hidden' });
    // Paired with width:100% on purpose. maxWidth:0 alone makes the column the
    // narrowest ALWAYS rather than only when crowded — it truncated at 1440 with
    // ~180px of empty table beside it. The pair is the fix; either half is not.
    expect(truncating).toHaveStyle({ maxWidth: '0', width: '100%' });
    expect(holding).not.toHaveStyle({ textOverflow: 'ellipsis' });
  });

  it('leaves every column alone when nothing opts in', () => {
    const { container } = render(
      <Table<Row> columns={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} rows={rows} />,
    );
    for (const cell of container.querySelectorAll('tbody td')) {
      expect(cell).not.toHaveStyle({ textOverflow: 'ellipsis' });
    }
  });
});
