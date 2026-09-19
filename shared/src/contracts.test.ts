import { describe, it, expectTypeOf } from 'vitest';
import type {
  StatusLevel, ServiceId, ServiceStatus, SourceResult,
  Incident, Severity, EntraSnapshot, EndpointSnapshot,
  EmailSnapshot, LogSourceSnapshot, AlertRule, Integration,
} from './contracts.js';

describe('contracts', () => {
  it('StatusLevel carries both amendment-1 members', () => {
    expectTypeOf<'unknown'>().toMatchTypeOf<StatusLevel>();
    expectTypeOf<'maintenance'>().toMatchTypeOf<StatusLevel>();
  });

  it('ServiceId is exactly the seven verified vendors', () => {
    expectTypeOf<ServiceId>().toEqualTypeOf<
      'proofpoint' | 'jira' | 'helpjuice' | 'claude' | 'openai' | 'zendesk' | 'm365'
    >();
  });

  it('SourceResult carries the amendment-4 empty flag', () => {
    expectTypeOf<SourceResult<number>>().toHaveProperty('empty');
  });

  it('ServiceStatus.vendor carries the amendment-2 history fields', () => {
    expectTypeOf<ServiceStatus['vendor']>().toHaveProperty('incidentsSince');
    expectTypeOf<ServiceStatus['vendor']>().toHaveProperty('lastSuccessfulPoll');
    expectTypeOf<ServiceStatus['vendor']>().toHaveProperty('maintenance');
  });

  it('Severity admits the info member', () => {
    expectTypeOf<'info'>().toMatchTypeOf<Severity>();
  });

  it('every snapshot type is exported', () => {
    expectTypeOf<Incident>().not.toBeNever();
    expectTypeOf<EntraSnapshot>().not.toBeNever();
    expectTypeOf<EndpointSnapshot>().not.toBeNever();
    expectTypeOf<EmailSnapshot>().not.toBeNever();
    expectTypeOf<LogSourceSnapshot>().not.toBeNever();
    expectTypeOf<AlertRule>().not.toBeNever();
    expectTypeOf<Integration>().not.toBeNever();
  });
});
