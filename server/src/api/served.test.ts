import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * **The other half of `web/src/guards.test.ts`'s contract-field guard, pointed
 * the opposite way.**
 *
 * `m4-views` built the half that catches a *parser dropping a field the API
 * serves* — which found `ack`, `muted`, `VendorIncident.url` and
 * `VendorIncident.title` sitting declared and unread. They flagged, correctly,
 * that it does not span the workspaces either: it reads the contract and
 * `web/src/live/*`, so **a route that stops serving a field the parser
 * faithfully reads has nothing watching it.** This is that direction.
 *
 * The shipped defect it is built from: `/api/incidents` began serving `ack`
 * and `muted`; the browser's `incidentView` built an `Incident` without either;
 * an acknowledged incident rendered as untouched with the button still inviting
 * the operator to press it again. Neither half was wrong when written. Each
 * became wrong when the other moved.
 *
 * **Why this is an enumeration and not a behavioural test.** The behavioural
 * protection already exists and is stronger — `routes.test.ts`'s no-stub run
 * writes an ack through the API and reads it back, so "stops serving `ack`"
 * cannot survive. What no behavioural test can catch is the field that is
 * ADDED and never served: nothing fails, because nothing ever asked. So the
 * optional surface of `ApiIncident` is pinned as a set, and each member must be
 * named by an assertion somewhere in the route tests.
 *
 * Every rule here has a control, both directions, for the reason the rest of
 * this repo does: an absence-claim that matches nothing is green for the same
 * reason a correct one is.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const read = (p: string) => readFileSync(join(HERE, p), 'utf8');

/** Comments blanked without moving a line — this file's own prose names every
 *  field it guards, and so does `routes.ts`'s. */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, '$1');

/** The optional fields of a named exported type, read out of the source rather
 *  than out of the type system: `tsc` cannot enumerate a type's keys at
 *  runtime, and the thing being guarded is the SET, not any one member. */
export function optionalFieldsOf(source: string, typeName: string): string[] {
  const code = stripComments(source);
  const start = code.indexOf(`export type ${typeName} = {`);
  if (start === -1) return [];
  const end = code.indexOf('\n};', start);
  if (end === -1) return [];
  return [...code.slice(start, end).matchAll(/^\s{2}([A-Za-z0-9_$]+)\?:/gm)].map((m) => m[1]!).sort();
}

describe('every optional field the API can serve is exercised by a test', () => {
  const routes = read('routes.ts');
  const tests = stripComments(read('routes.test.ts'));

  /**
   * The pinned set. Adding a field to `ApiIncident` fails here until somebody
   * writes it down AND writes a test that names it — which is the whole point:
   * `ack` and `muted` were declared in the frozen contract in Milestone 1 and
   * nothing served or read them for four months, because an optional field that
   * nobody fills breaks nothing.
   */
  const OPTIONAL = ['ack', 'muted', 'resolvedAt', 'severityRaw'];

  it('ApiIncident has exactly these optional fields', () => {
    expect(optionalFieldsOf(routes, 'ApiIncident')).toEqual([...OPTIONAL].sort());
  });

  it('and each one is named by an assertion in the route tests', () => {
    // Not "is mentioned in routes.ts": `ack` and `muted` are produced by a
    // SPREAD of the store's flags, so the producing code never names them at
    // all. A grep of the implementation would have to be satisfied by the one
    // thing that cannot be greppped for. The tests are where the names
    // necessarily appear.
    const unexercised = OPTIONAL.filter((f) => !new RegExp(`\\b${f}\\b`).test(tests));
    expect(unexercised).toEqual([]);
  });

  it('would see a field added and left unserved — the control', () => {
    const planted = 'export type ApiIncident = {\n  id: string;\n  ack?: Flags;\n  blastRadius?: string[];\n};\n';
    expect(optionalFieldsOf(planted, 'ApiIncident')).toEqual(['ack', 'blastRadius']);
    // …and the pinned set does not contain it, so the first assertion fails.
    expect(OPTIONAL).not.toContain('blastRadius');
  });

  it('would see a field dropped from the type — the other direction', () => {
    const planted = 'export type ApiIncident = {\n  id: string;\n};\n';
    expect(optionalFieldsOf(planted, 'ApiIncident')).toEqual([]);
  });

  it('does not read prose, a required field, or a nested type — three ways to be wrong', () => {
    // Required fields are not open loops in this sense: the typechecker makes
    // somebody fill them. Optional ones are the silent case.
    const planted =
      'export type ApiIncident = {\n' +
      '  /** ack? in a comment */\n' +
      '  id: string;\n' +
      '  nested: { inner?: string };\n' +
      '  real?: number;\n' +
      '};\n';
    expect(optionalFieldsOf(planted, 'ApiIncident')).toEqual(['real']);
  });

  it('is reading the real file, not an empty string', () => {
    // The anchor. Every assertion above is satisfied by a source that could not
    // be read at all — a wrong path, a renamed file, a walk that found nothing.
    expect(routes.length).toBeGreaterThan(10_000);
    expect(routes).toContain('export type ApiIncident = {');
    expect(tests).toContain('GET /api/incidents');
  });
});
