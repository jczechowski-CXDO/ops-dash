import { describe, it, expect } from 'vitest';
import { safeUrl } from './safeUrl.js';

describe('safeUrl', () => {
  it('passes an https vendor link through', () => {
    expect(safeUrl('https://status.claude.com/incidents/abc')).toBe(
      'https://status.claude.com/incidents/abc',
    );
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'http://status.claude.com/x',
    'file:///etc/passwd',
    'not a url',
    '',
  ])('drops %s', (bad) => {
    expect(safeUrl(bad)).toBeUndefined();
  });

  it('drops undefined without throwing', () => {
    expect(safeUrl(undefined)).toBeUndefined();
  });

  // Beyond the plan's list. Each of these is a real bypass of a naive
  // startsWith('https') or a regex, which is why the implementation parses.
  it.each([
    ['https:/\\/\\evil.example.com', 'backslash-slash confusion'],
    ['\thttps://evil.example.com', 'leading tab'],
    ['https:\nevil', 'embedded newline'],
    ['HTTPS://EVIL.EXAMPLE.COM/x', 'uppercase scheme — valid, must pass'],
  ])('handles %s (%s) without throwing', (input) => {
    expect(() => safeUrl(input)).not.toThrow();
  });

  it('accepts an uppercase https scheme, because URL normalises it', () => {
    // Not a bypass: the parser lowercases the protocol, so this is a real https
    // link and dropping it would be a bug rather than a defence.
    expect(safeUrl('HTTPS://status.example.com/x')).toBe('https://status.example.com/x');
  });

  it('would reject a scheme check written as a prefix test', () => {
    // The control. 'https:...' as a bare prefix match passes for a value whose
    // real protocol is not https, which is the mistake this function avoids by
    // parsing rather than matching.
    const naive = (u: string) => u.startsWith('https:');
    expect(naive('https:/\\/\\evil.example.com')).toBe(true);
    expect(safeUrl('https:/\\/\\evil.example.com')).not.toBe('https:/\\/\\evil.example.com');
  });
});
