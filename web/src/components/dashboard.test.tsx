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

  // A `null` is a probe that did not answer. `server/src/api/tile.ts` argues
  // why both easy disposals draw an outage as good news: dropping the sample
  // leaves a shorter, healthier line, zeroing it leaves one diving to
  // instantaneous. These four assert it is drawn as neither.
  describe('a sample that did not answer', () => {
    const xs = (container: HTMLElement) =>
      [...container.querySelectorAll('polyline')].flatMap((p) =>
        (p.getAttribute('points') ?? '').split(' ').map((pt) => pt.split(',')[0]),
      );

    it('keeps its x position, so a gap cannot read as a shorter history', () => {
      // Five slots, one hole. The answered samples sit at indices 0, 1, 3, 4
      // of FIVE — x = 0, 25, 75, 100. Dropping the hole would give four samples
      // of four: 0, 33.3, 66.7, 100. The literals are the whole point.
      const { container } = render(
        <Sparkline values={[100, 200, null, 300, 400]} color="var(--success-main)" height={26} viewBoxHeight={26} />,
      );
      expect(xs(container)).toEqual(['0.0', '25.0', '75.0', '100.0']);
    });

    it('breaks the line rather than bridging the gap', () => {
      const { container } = render(
        <Sparkline values={[100, 200, null, 300, 400]} color="var(--success-main)" height={26} viewBoxHeight={26} />,
      );
      const runs = [...container.querySelectorAll('polyline')];
      expect(runs).toHaveLength(2);
      expect(runs[0]?.getAttribute('points')).toBe('0.0,24.0 25.0,16.7');
      expect(runs[1]?.getAttribute('points')).toBe('75.0,9.3 100.0,2.0');
    });

    it('takes no part in the scale, so it cannot drag the floor to zero', () => {
      // Four identical answered samples: the flat mid-line, y = 26 / 2 = 13.0,
      // exactly as if the hole were not there. Treated as 0 the span becomes
      // 0..200 and the answered samples climb to the top of the box (y = 2.0).
      const { container } = render(
        <Sparkline values={[200, 200, null, 200, 200]} color="var(--success-main)" height={26} viewBoxHeight={26} />,
      );
      const ys = [...container.querySelectorAll('polyline')].flatMap((p) =>
        (p.getAttribute('points') ?? '').split(' ').map((pt) => pt.split(',')[1]),
      );
      expect(ys).toEqual(['13.0', '13.0', '13.0', '13.0']);
    });

    it('still draws the one probe that answered between two that did not', () => {
      const { container } = render(
        <Sparkline values={[null, 250, null]} color="var(--success-main)" height={26} viewBoxHeight={26} />,
      );
      const dot = container.querySelector('polyline');
      // A one-point polyline paints nothing, so the point is repeated and the
      // round cap makes it a dot. Centre slot of three: x = 50.
      expect(dot?.getAttribute('points')).toBe('50.0,13.0 50.0,13.0');
      expect(dot?.getAttribute('stroke-linecap')).toBe('round');
    });

    it('draws a genuine 0 ms sample as a measurement, not as a hole', () => {
      // `parse.ts` maps a non-finite entry to `null`, so a `0` that arrives
      // here is a probe that answered in under a millisecond. The hole test is
      // `v !== null` and never falsiness; `!v` would delete a real reading.
      const { container } = render(
        <Sparkline values={[0, 100, 200]} color="var(--success-main)" height={26} viewBoxHeight={26} />,
      );
      const line = container.querySelector('polyline');
      expect(container.querySelectorAll('polyline')).toHaveLength(1); // one run, no break
      expect(line?.getAttribute('points')).toBe('0.0,24.0 50.0,13.0 100.0,2.0');
    });

    it('spans the ORIGINAL indices on the series measured off the live store', () => {
      // The lead wrote an island into the live store — two timeouts, one lone
      // answer, two more timeouts on a Zendesk pod — and photographed the old
      // rendering in Chromium: 17 points at an even 6.25 spacing, because 21
      // samples minus 4 dropped is 17 and 100/16 is 6.25. The gaps had closed
      // up completely while the copy beside the chart correctly read "4 of 21
      // samples are missing". A true label on a misleading shape.
      //
      // 21 slots means a step of 100/20 = 5.0, and the answered samples must
      // land on multiples of it. 6.25 anywhere means the gap is still closing.
      const values = [...Array.from({ length: 16 }, (_, i) => 100 + i), null, null, 240, null, null];
      const { container } = render(
        <Sparkline values={values} color="var(--success-main)" height={26} viewBoxHeight={26} />,
      );
      const runs = [...container.querySelectorAll('polyline')];
      expect(runs).toHaveLength(2);
      expect(xs(container).slice(0, 16)).toEqual(
        Array.from({ length: 16 }, (_, i) => (i * 5).toFixed(1)),
      );
      // Index 18 of 21 — the lone answer between two pairs of timeouts. It is
      // the highest sample in the series, so it sits at the top of the box.
      expect(runs[1]?.getAttribute('points')).toBe('90.0,2.0 90.0,2.0');
      expect(runs[1]?.getAttribute('stroke-linecap')).toBe('round');
      // Nothing is drawn past the trailing holes: the series ends at 90, not
      // at 100, because the last two probes did not answer.
      expect(xs(container).at(-1)).toBe('90.0');
    });

    it('renders nothing at all when nothing answered — not an empty frame', () => {
      // `m3-runs` found this: disabling the early return survived both suites,
      // because every sparkline test reaches for a `polyline` and an empty
      // `<svg>` has none. Rendered, the difference is "" versus a 26px frame.
      // The contract to the views is that empty and all-null return NOTHING and
      // the views phrase the two cases; a frame would take 26px of a 190px tile
      // and push the copy that explains the absence out of position.
      const { container } = render(
        <Sparkline values={[null, null, null]} color="var(--success-main)" height={26} viewBoxHeight={26} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing at all for an empty series — not an empty frame', () => {
      const { container } = render(
        <Sparkline values={[]} color="var(--success-main)" height={26} viewBoxHeight={26} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('leaves a series with no holes byte-identical, so no baseline can move', () => {
      const { container } = render(
        <Sparkline values={[100, 300, 400]} color="var(--success-main)" height={26} viewBoxHeight={26} />,
      );
      const line = container.querySelector('polyline');
      expect(line?.getAttribute('points')).toBe('0.0,24.0 50.0,9.3 100.0,2.0');
      expect(line?.getAttribute('stroke-linecap')).toBeNull();
    });
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

  // The product rule: a stale panel shows the last good data, visibly marked,
  // WITH the reason. An age and no cause tells an operator to refresh when what
  // they need to do is look at the vendor's status page.
  it('says WHY the data is stale, not only how old it is', () => {
    const fourteenMinutesAgo = new Date(Date.now() - 14 * 60_000).toISOString();
    render(
      <Panel state={{ kind: 'stale', source: 'Zendesk', fetchedAt: fourteenMinutesAgo, reason: 'the feed returned 503' }}>
        <p>last good</p>
      </Panel>,
    );
    expect(screen.getByText('the feed returned 503')).toBeInTheDocument();
    expect(screen.getByText('last good')).toBeInTheDocument();
  });

  it('announces the reason in the same live region as the age', () => {
    // Beside the alert rather than inside it, the cause sits outside
    // `role="alert"` and a screen reader hears the age and never hears why.
    const fourteenMinutesAgo = new Date(Date.now() - 14 * 60_000).toISOString();
    render(
      <Panel state={{ kind: 'stale', source: 'Zendesk', fetchedAt: fourteenMinutesAgo, reason: 'the feed returned 503' }}>
        <p>last good</p>
      </Panel>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Zendesk data is 14 minutes');
    expect(alert).toContainElement(screen.getByTestId('panel-stale-reason'));
  });

  it('is unchanged when there is no reason to give', () => {
    const fourteenMinutesAgo = new Date(Date.now() - 14 * 60_000).toISOString();
    render(
      <Panel state={{ kind: 'stale', source: 'Zendesk', fetchedAt: fourteenMinutesAgo }}><p>last good</p></Panel>,
    );
    // Pinned whole, including the severity word the alert prepends for screen
    // readers: an empty reason element or a stray separator would show up here.
    expect(screen.getByRole('alert').textContent).toBe('Warning:Zendesk data is 14 minutes old');
    expect(screen.queryByTestId('panel-stale-reason')).toBeNull();
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
