import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditProblems, check, EXCEPTIONS, main, type AuditException } from '../../scripts/audit.ts';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
const spawn = vi.mocked(spawnSync);

const PICOMATCH = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const GLOB = 'https://github.com/advisories/GHSA-3g3m-2fjr-6pw4';

/** The shape `npm audit --json` (lockfile v3, npm 11) writes, cut down to what the check reads. */
function report(...advisories: { name: string; url: string; title: string }[]): unknown {
  const vulnerabilities: Record<string, unknown> = {};
  for (const a of advisories) {
    vulnerabilities[a.name] = { name: a.name, via: [{ source: 1, name: a.name, title: a.title, url: a.url }] };
  }
  // A package vulnerable only through another names it as a string; it adds no advisory of its own.
  vulnerabilities.vitest = { name: 'vitest', via: ['picomatch'] };
  return { auditReportVersion: 2, vulnerabilities };
}

const picomatch = { name: 'picomatch', url: PICOMATCH, title: 'picomatch vulnerable to ReDoS' };
const glob = { name: 'glob', url: GLOB, title: 'Glob: AbortSignal cancellation bypass' };
const exception: AuditException = {
  advisory: 'GHSA-fc5q-39xc-vjpf',
  expires: '2026-12-01',
  ticket: 'shyden-labs/playwright-devices#22',
  reason: 'no patched picomatch release',
};

describe('auditProblems', () => {
  it('passes an excepted advisory before its expiry date', () => {
    expect(auditProblems(report(picomatch), [exception], '2026-11-30')).toEqual([]);
  });

  it('fails an advisory with no exception, naming it, its title and its package', () => {
    expect(auditProblems(report(picomatch, glob), [exception], '2026-11-18')).toEqual([
      'GHSA-3g3m-2fjr-6pw4 (Glob: AbortSignal cancellation bypass) in glob has no exception: fix it',
    ]);
  });

  it('fails an exception on its expiry date, naming the date and the ticket', () => {
    expect(auditProblems(report(picomatch), [exception], '2026-12-01')).toEqual([
      'the exception for GHSA-fc5q-39xc-vjpf expired on 2026-12-01 (shyden-labs/playwright-devices#22): fix it or ask Shyden',
    ]);
  });

  it('fails an exception whose advisory npm no longer reports, so it is removed once fixed', () => {
    expect(auditProblems(report(), [exception], '2026-11-18')).toEqual([
      'the exception for GHSA-fc5q-39xc-vjpf is no longer needed: remove it and close shyden-labs/playwright-devices#22',
    ]);
  });

  it('names an advisory once when several packages carry it', () => {
    const twice = report(glob, { ...glob, name: 'glob-two' });
    expect(auditProblems(twice, [], '2026-11-18')).toEqual([
      'GHSA-3g3m-2fjr-6pw4 (Glob: AbortSignal cancellation bypass) in glob, glob-two has no exception: fix it',
    ]);
  });

  it('fails closed on a report with no vulnerabilities map', () => {
    expect(auditProblems({ error: { code: 'ENOLOCK' } }, [exception], '2026-11-18')).toEqual([
      'npm audit gave no vulnerabilities map: {"error":{"code":"ENOLOCK"}}',
    ]);
  });

  it('fails closed on an advisory with no GitHub advisory id in its URL', () => {
    const odd = report({ name: 'odd', url: 'https://example.com/advisory', title: 'Odd' });
    expect(auditProblems(odd, [], '2026-11-18')).toEqual(['odd: an advisory with no GHSA id in its URL (https://example.com/advisory)']);
  });

  it('carries no exception: GitHub withdrew the picomatch advisory on 2026-11-18 (shyden-labs/playwright-devices#22)', () => {
    expect(EXCEPTIONS).toEqual([]);
  });
});

describe('main', () => {
  afterEach(() => {
    vi.useRealTimers();
    spawn.mockReset();
  });

  const npmGives = (body: unknown) =>
    spawn.mockReturnValue({ status: 1, stdout: JSON.stringify(body), stderr: '' } as SpawnSyncReturns<string>);

  it('runs npm audit as JSON and passes, printing nothing, when npm reports no advisory', () => {
    npmGives({ auditReportVersion: 2, vulnerabilities: {} });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(main()).toBe(0);
    expect(spawn).toHaveBeenCalledExactlyOnceWith('npm', ['audit', '--json'], { encoding: 'utf8' });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });

  it('fails, printing every problem, when npm reports advisories with no exception', () => {
    npmGives(report(picomatch, glob));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main()).toBe(1);
    expect(error.mock.calls.map(([line]) => line as string)).toEqual([
      'audit: GHSA-fc5q-39xc-vjpf (picomatch vulnerable to ReDoS) in picomatch has no exception: fix it',
      'audit: GHSA-3g3m-2fjr-6pw4 (Glob: AbortSignal cancellation bypass) in glob has no exception: fix it',
    ]);
    error.mockRestore();
    log.mockRestore();
  });

  it('passes an advisory with an exception it is given, printing the exception', () => {
    vi.useFakeTimers({ now: new Date('2026-11-18T10:00:00Z') });
    npmGives(report(picomatch));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(check([exception])).toBe(0);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'audit: GHSA-fc5q-39xc-vjpf excepted until 2026-12-01 (shyden-labs/playwright-devices#22): no patched picomatch release',
    );
    log.mockRestore();
  });

  it('fails closed when npm audit prints something that is not JSON', () => {
    spawn.mockReturnValue({ status: 1, stdout: 'npm error network', stderr: 'offline' } as SpawnSyncReturns<string>);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(main()).toBe(1);
    expect(error).toHaveBeenCalledWith('audit: npm audit did not print JSON (exit 1): offline');
    error.mockRestore();
  });
});
