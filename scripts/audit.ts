/**
 * Runs `npm audit` and fails on every known vulnerability, of any severity and dev dependencies
 * included (shyden-labs/repo-template#156), except an advisory with a dated exception below
 * (shyden-labs/playwright-devices#22):
 *
 *   node scripts/audit.ts
 *
 * An exception exists only by Shyden's ruling and fails the build on its expiry date, and as soon
 * as npm stops reporting its advisory, so it is removed once the fix lands. Shyden, 2026-11-18, on
 * the picomatch advisory: "temporary exception. every session start needs to run a check for an
 * update to address this and then remove the exception" (~/.claude/global-rules/
 * picomatch-audit-exception-check.md).
 */
import { spawnSync } from 'node:child_process';
import { runIfEntry } from './cli.ts';

export interface AuditException {
  /** The GitHub advisory id, e.g. GHSA-fc5q-39xc-vjpf. */
  advisory: string;
  /** The first day (YYYY-MM-DD) the exception no longer holds. */
  expires: string;
  ticket: string;
  reason: string;
}

// Empty: GitHub withdrew the picomatch advisory GHSA-fc5q-39xc-vjpf on 2026-11-18 at 15:38 UTC, and
// npm audit stopped reporting it (shyden-labs/playwright-devices#22).
export const EXCEPTIONS: AuditException[] = [];

// npm writes every field read here on each advisory (npm 11, `npm audit --json`).
interface Via {
  title: string;
  url: string;
}

interface Advisory {
  title: string;
  packages: string[];
}

/** Every advisory npm reports, by GHSA id, with the packages that carry it, and each one it could not read; or why the report is unreadable. */
function readAdvisories(report: unknown): { advisories: Map<string, Advisory>; problems: string[] } | string {
  const advisories = new Map<string, Advisory>();
  const problems: string[] = [];
  const vulnerabilities = (report as { vulnerabilities?: unknown } | null)?.vulnerabilities;
  if (typeof vulnerabilities !== 'object' || vulnerabilities === null) {
    return `npm audit gave no vulnerabilities map: ${JSON.stringify(report)}`;
  }
  for (const [name, entry] of Object.entries(vulnerabilities as Record<string, { via: (Via | string)[] }>)) {
    for (const via of entry.via) {
      // A string names another vulnerable package; that package's own entry carries the advisory.
      if (typeof via === 'string') continue;
      const id = /GHSA(?:-[0-9a-z]{4}){3}$/.exec(via.url)?.[0];
      if (id === undefined) {
        problems.push(`${name}: an advisory with no GHSA id in its URL (${via.url})`);
        continue;
      }
      const known = advisories.get(id) ?? { title: via.title, packages: [] };
      known.packages.push(name);
      advisories.set(id, known);
    }
  }
  return { advisories, problems };
}

/** Every reason the audit fails, one line each; empty when it passes. `today` is YYYY-MM-DD. */
export function auditProblems(report: unknown, exceptions: AuditException[], today: string): string[] {
  const read = readAdvisories(report);
  if (typeof read === 'string') return [read];
  const { advisories, problems } = read;
  const excepted = new Map(exceptions.map((e) => [e.advisory, e]));
  for (const [id, advisory] of advisories) {
    if (!excepted.has(id)) problems.push(`${id} (${advisory.title}) in ${advisory.packages.join(', ')} has no exception: fix it`);
  }
  for (const e of exceptions) {
    if (!advisories.has(e.advisory)) {
      problems.push(`the exception for ${e.advisory} is no longer needed: remove it and close ${e.ticket}`);
    } else if (today >= e.expires) {
      problems.push(`the exception for ${e.advisory} expired on ${e.expires} (${e.ticket}): fix it or ask Shyden`);
    }
  }
  return problems;
}

export function main(): number {
  // `npm audit` exits 1 whenever it finds anything, excepted or not, so its JSON is the verdict.
  const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' }); // NOSONAR: npm is found on PATH by design, its folder differs on the Mac and on CI (shyden-labs/playwright-devices#12)
  let report: unknown;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.error(`audit: npm audit did not print JSON (exit ${String(run.status)}): ${run.stderr.trim()}`);
    return 1;
  }
  const today = new Date().toISOString().slice(0, 10);
  const problems = auditProblems(report, EXCEPTIONS, today);
  for (const e of EXCEPTIONS) console.log(`audit: ${e.advisory} excepted until ${e.expires} (${e.ticket}): ${e.reason}`);
  for (const problem of problems) console.error(`audit: ${problem}`);
  return problems.length > 0 ? 1 : 0;
}

await runIfEntry(import.meta.url, main);
