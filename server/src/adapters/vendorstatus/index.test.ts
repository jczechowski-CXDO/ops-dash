import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../../http/fetchJson.js';
import type { SourceResult } from '@ops-dash/shared';
import { VENDORS_JSON, loadVendorFeeds, pollVendor, type Vendor, type VendorFeed } from './index.js';

/** Amendment 9 made `data` optional: an errored SourceResult carries no
 *  payload. These adapters promise one on EVERY path anyway — a broken feed is
 *  still a renderable `unknown` vendor half, with a note saying why — so this
 *  helper asserts that promise rather than papering over the optionality with a
 *  `!`. A path that quietly stops keeping it fails the test that touches it. */
const vendorOf = (result: SourceResult<Vendor>): Vendor => {
  if (result.data === undefined) throw new Error('the adapter returned no vendor half');
  return result.data;
};

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(HERE, '__fixtures__', name), 'utf8');

const dirs: string[] = [];
const tempConfig = (contents: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ops-dash-vendors-'));
  dirs.push(dir);
  const path = join(dir, 'vendors.json');
  writeFileSync(path, JSON.stringify(contents, null, 2));
  return path;
};
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** Records every URL it is asked for, so a test can assert which document the
 *  dispatch actually reached for — and that an unsupported platform reaches for
 *  nothing at all. */
const recording = (body: string) => {
  const urls: string[] = [];
  const respond: FetchLike = async (url) => {
    urls.push(url);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { urls, respond };
};

describe('the shipped vendors.json', () => {
  it('lists the five public feeds this milestone polls', () => {
    const feeds = loadVendorFeeds();
    expect(feeds.map((f) => f.id)).toEqual(['jira', 'helpjuice', 'claude', 'openai', 'zendesk']);
    expect(feeds.map((f) => f.platform)).toEqual([
      'statuspage',
      'statuspage',
      'statuspage',
      'statuspage',
      'zendesk-ssp',
    ]);
  });

  it('points only at https URLs', () => {
    // The SSRF floor. This process fetches exactly what this file says.
    for (const feed of loadVendorFeeds()) expect(feed.url.startsWith('https://')).toBe(true);
  });

  it('is the file next to this one', () => {
    expect(VENDORS_JSON).toBe(join(HERE, 'vendors.json'));
  });
});

describe('a malformed vendors.json stops the process rather than dropping a tile', () => {
  it('rejects an id that is not a ServiceId', () => {
    const path = tempConfig({ feeds: [{ id: 'dropbox', platform: 'statuspage', url: 'https://x/api/v2/summary.json' }] });
    expect(() => loadVendorFeeds(path)).toThrow(/not a ServiceId/);
  });

  it('rejects a platform that is not a VendorPlatform', () => {
    const path = tempConfig({ feeds: [{ id: 'jira', platform: 'pingdom', url: 'https://x/api/v2/summary.json' }] });
    expect(() => loadVendorFeeds(path)).toThrow(/not a VendorPlatform/);
  });

  it('rejects a non-https URL', () => {
    const path = tempConfig({ feeds: [{ id: 'jira', platform: 'statuspage', url: 'http://x/api/v2/summary.json' }] });
    expect(() => loadVendorFeeds(path)).toThrow(/must be https/);
  });

  it('rejects two rows claiming the same service', () => {
    const url = 'https://x/api/v2/summary.json';
    const path = tempConfig({
      feeds: [
        { id: 'jira', platform: 'statuspage', url },
        { id: 'jira', platform: 'statuspage', url },
      ],
    });
    expect(() => loadVendorFeeds(path)).toThrow(/duplicate id jira/);
  });

  it('rejects a file with no feeds array', () => {
    const path = tempConfig({ vendors: [] });
    expect(() => loadVendorFeeds(path)).toThrow(/feeds/);
  });
});

describe('platform dispatch', () => {
  it('sends a statuspage row to the Statuspage adapter', async () => {
    const { urls, respond } = recording(fixture('statuspage-jira-summary.json'));
    const feed = loadVendorFeeds().find((f) => f.id === 'jira')!;
    const result = await pollVendor(feed, respond);
    expect(vendorOf(result).level).toBe('operational');
    expect(urls).toEqual(['https://jira-software.status.atlassian.com/api/v2/summary.json']);
  });

  it('sends a zendesk-ssp row to the SSP adapter, which asks for incidents.json', async () => {
    const { urls, respond } = recording(fixture('zendesk-ssp-incidents.json'));
    const feed = loadVendorFeeds().find((f) => f.id === 'zendesk')!;
    const result = await pollVendor(feed, respond);
    expect(vendorOf(result).level).toBe('unknown');
    expect(urls).toEqual(['https://status.zendesk.com/api/ssp/incidents.json']);
  });

  it('answers for a platform with no adapter without making a request', async () => {
    const { urls, respond } = recording('{}');
    const feed: VendorFeed = { id: 'm365', platform: 'msgraph', url: 'https://graph.microsoft.com/v1.0/x' };
    const result = await pollVendor(feed, respond);
    expect(result.error?.code).toBe('platform_unsupported');
    expect(vendorOf(result).level).toBe('unknown');
    expect(vendorOf(result).platform).toBe('msgraph');
    expect(urls).toEqual([]);
  });
});

describe('the config claim: a fifth Statuspage vendor is a config line and no code', () => {
  it('polls a vendor that exists only in a config file', async () => {
    // The design's central claim about this adapter. If this test ever needs a
    // change to statuspage.ts to pass, the claim is false and the design owes
    // an answer. It did not, on 2026-09-19.
    const shipped = loadVendorFeeds();
    const fifth = {
      id: 'proofpoint',
      platform: 'statuspage',
      url: 'https://status.hornetsecurity.example/api/v2/summary.json',
    };
    const path = tempConfig({ feeds: [...shipped, fifth] });

    const feeds = loadVendorFeeds(path);
    expect(feeds.length).toBe(6);
    expect(feeds.filter((f) => f.platform === 'statuspage').length).toBe(5);

    const added = feeds.find((f) => f.id === 'proofpoint')!;
    const { urls, respond } = recording(fixture('statuspage-helpjuice-summary.json'));
    const result = await pollVendor(added, respond);

    expect(vendorOf(result).level).toBe('operational');
    expect(vendorOf(result).platform).toBe('statuspage');
    expect(urls).toEqual(['https://status.hornetsecurity.example/api/v2/summary.json']);
  });

  it('honours a component filter that exists only in a config file', async () => {
    // The other half of config-driven: narrowing to one component is also data.
    const path = tempConfig({
      feeds: [
        {
          id: 'jira',
          platform: 'statuspage',
          url: 'https://jira-software.status.atlassian.com/api/v2/summary.json',
          component: 'Search',
        },
      ],
    });
    const feed = loadVendorFeeds(path)[0]!;
    expect(feed.component).toBe('Search');

    const body = JSON.parse(fixture('statuspage-jira-summary.json')) as {
      components: Array<{ name: string; status: string }>;
    };
    body.components.forEach((c) => {
      if (c.name === 'Search') c.status = 'major_outage';
    });
    const { respond } = recording(JSON.stringify(body));
    const result = await pollVendor(feed, respond);
    expect(vendorOf(result).level).toBe('outage');
  });
});
