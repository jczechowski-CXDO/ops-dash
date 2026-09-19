// One-time, build-time only. Downloads the Plus Jakarta Sans variable font from
// Google Fonts and writes a local @font-face sheet. Output is committed; nothing
// at runtime ever reaches Google. Plus Jakarta Sans is OFL, so vendoring is fine.
import { mkdirSync, writeFileSync } from 'node:fs';

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap';
// A modern desktop UA is required or Google serves ttf instead of woff2.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// English-only internal tool: latin and latin-ext are enough. Dropping the
// cyrillic-ext and vietnamese subsets halves the payload.
const KEEP = new Set(['latin', 'latin-ext']);

const css = await fetch(CSS_URL, { headers: { 'User-Agent': UA } }).then((r) => {
  if (!r.ok) throw new Error(`Google Fonts returned ${r.status}`);
  return r.text();
});

mkdirSync('public/fonts', { recursive: true });

const blocks = css.split('/*').slice(1);
const out = [
  '/* Plus Jakarta Sans (OFL), vendored from Google Fonts. Local only — no @import.',
  '   Regenerate with: npm run fonts --workspace @ops-dash/web',
  '   Urbanist is deliberately absent: all three --font-* tokens below point at',
  '   Plus Jakarta Sans, so Urbanist was downloaded but never rendered.',
  '   The Material Symbols webfont is deliberately absent: all 11 icons are inline',
  '   SVG from src/components/aurora/icons.generated.ts. */',
  '',
];
let written = 0;

for (const block of blocks) {
  const subset = block.slice(0, block.indexOf('*/')).trim();
  if (!KEEP.has(subset)) continue;
  const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal';
  const url = /src:\s*url\((https:[^)]+)\)/.exec(block)?.[1];
  const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
  if (!url || !range) throw new Error(`could not parse @font-face for ${subset}/${style}`);

  const file = `plus-jakarta-sans-${subset}-${style}.woff2`;
  const bytes = Buffer.from(await fetch(url).then((r) => r.arrayBuffer()));
  writeFileSync(`public/fonts/${file}`, bytes);
  written++;

  out.push(
    '@font-face {',
    "  font-family: 'Plus Jakarta Sans';",
    `  font-style: ${style};`,
    '  font-weight: 200 800;',
    '  font-display: swap;',
    `  src: url('/fonts/${file}') format('woff2');`,
    `  unicode-range: ${range};`,
    '}',
    '',
  );
}

out.push(
  ':root {',
  '  --font-display: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
  '  --font-body: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
  '  --font-ui: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
  '  --font-mono: "SF Mono", ui-monospace, "SFMono-Regular", "Menlo", "Consolas", monospace;',
  '}',
  '',
);

writeFileSync('public/aurora/tokens/fonts.css', out.join('\n'));
console.log(`vendored ${written} woff2 files; wrote public/aurora/tokens/fonts.css`);
