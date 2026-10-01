import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Icon } from '../components/aurora/Icon.js';
import { IconButton } from '../components/aurora/IconButton.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { useDemoMode } from './DemoModeProvider.js';
import { useDashboard } from '../live/DataSource.js';
import { metaSourceOf, pageMeta } from './pageMeta.js';

const REFRESH_SECONDS = 30;

const clockText = (d: Date): string =>
  [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');

export function Header() {
  const { pathname } = useLocation();
  const { bundle } = useDemoMode();
  const { theme, toggle } = useTheme();
  const [now, setNow] = useState(() => new Date());
  const [remaining, setRemaining] = useState(REFRESH_SECONDS);

  // One interval drives both the clock and the countdown; two would drift apart
  // on screen for no benefit. Cleared on unmount.
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
      setRemaining((r) => (r <= 1 ? REFRESH_SECONDS : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // The header counts the same services and incidents the page below it
  // renders. Reading the fixture bundle here while the view read the API is how
  // a header comes to say "5 of 7 affirmed" over seven live tiles that say
  // something else.
  const { title, subtitle } = pageMeta(pathname, metaSourceOf(useDashboard(), bundle));
  const dark = theme === 'dark';

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 24px',
        background: 'var(--background-paper)',
        borderBottom: '1px solid var(--divider)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.015em', color: 'var(--text-primary)' }}>
          {title}
        </h1>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{subtitle}</div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 11px',
          border: '1px solid var(--divider)',
          borderRadius: 8,
          whiteSpace: 'nowrap',
          flex: '0 0 auto',
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--success-main)',
            animation: 'pulseDot 2s ease-in-out infinite',
          }}
        />
        Auto-refresh · {remaining}s
      </div>

      <div
        data-testid="clock"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 15,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--text-primary)',
        }}
      >
        {clockText(now)}
      </div>

      <IconButton onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
        <Icon name={dark ? 'light_mode' : 'nights_stay'} size={20} />
      </IconButton>
    </header>
  );
}
