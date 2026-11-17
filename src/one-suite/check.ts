/**
 * The shared one-suite checks (shyden-labs/playwright-devices#16): every target in a group runs the
 * same tests, the full list read from the spec files, with nothing skipped, failed or flaky, and a
 * test that belongs to one group only says so with a tag and a reason. Every problem is listed, one
 * line each; the checks never stop at the first.
 *
 * Input is Playwright's own output: `--list --reporter=json` reports give what each target should
 * run, and JSON reports give what it ran. Phones and desktop browsers run separately, so each may be
 * its own report; a report with no project names (a device run) is named by the caller.
 */
import type { JSONReport, JSONReportSuite, JSONReportTest } from '@playwright/test/reporter';

export interface ReportedTest {
  /** The file and the whole title path, e.g. "journey.spec.ts › outer › reads". */
  id: string;
  tags: string[];
  annotations: { type: string; description?: string }[];
  status: JSONReportTest['status'];
}

export interface TargetTests {
  tests: ReportedTest[];
}

export interface OneSuiteInput {
  /** What each target should run, from `playwright test --list --reporter=json`. */
  listed: Map<string, TargetTests>;
  /** What each target ran, from its JSON report. */
  ran: Map<string, TargetTests>;
  /** Each group's targets, e.g. { phones: ['ios-webkit'], desktop: ['chromium', 'firefox'] }. */
  groups: Record<string, string[]>;
}

export interface OneSuiteResult {
  /** One line per target, on pass and on fail. */
  totals: string[];
  problems: string[];
}

/** Every test in a report, by target: its project name, or `unnamedTarget` for a project with none. */
export function testsByTarget(report: JSONReport, unnamedTarget: string): Map<string, TargetTests> {
  const targets = new Map<string, TargetTests>();
  const visit = (suite: JSONReportSuite, path: string[]): void => {
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        const target = test.projectName === '' ? unnamedTarget : test.projectName;
        const entry = targets.get(target) ?? { tests: [] };
        entry.tests.push({ id: [...path, spec.title].join(' › '), tags: spec.tags, annotations: test.annotations, status: test.status });
        targets.set(target, entry);
      }
    }
    for (const child of suite.suites ?? []) visit(child, [...path, child.title]);
  };
  for (const file of report.suites) visit(file, [file.file]);
  return targets;
}

const ids = (target: TargetTests | undefined): Set<string> => new Set(target?.tests.map((t) => t.id));

export function checkOneSuite({ listed, ran, groups }: OneSuiteInput): OneSuiteResult {
  const problems: string[] = [];
  const totals: string[] = [];
  const groupOf = new Map(Object.entries(groups).flatMap(([group, targets]) => targets.map((target) => [target, group] as const)));

  for (const target of new Set([...listed.keys(), ...ran.keys()])) {
    if (!groupOf.has(target)) problems.push(`${target} is in no declared group`);
  }

  for (const [group, targets] of Object.entries(groups)) {
    const listedTotals = targets.filter((t) => listed.has(t)).map((t) => `${t} ${String(ids(listed.get(t)).size)}`);
    const sets = targets.filter((t) => listed.has(t)).map((t) => [...ids(listed.get(t))].sort().join('\n'));
    if (new Set(sets).size > 1) problems.push(`the ${group} group is listed different tests: ${listedTotals.join(', ')}`);

    for (const target of targets) {
      const expected = listed.get(target);
      if (expected === undefined) {
        problems.push(`${target} has no listed tests: pass its --list report`);
        continue;
      }
      const run = ran.get(target);
      totals.push(`${target}: ${String(run?.tests.length ?? 0)} tests`);
      if (run === undefined || run.tests.length === 0) {
        problems.push(`${target} ran no tests (it is in the ${group} group)`);
        continue;
      }
      const ranIds = ids(run);
      for (const id of ids(expected)) if (!ranIds.has(id)) problems.push(`${target} did not run "${id}" (listed for it)`);
      for (const test of run.tests) {
        if (!ids(expected).has(test.id)) problems.push(`${target} ran "${test.id}", which is not listed for it`);
        else if (test.status === 'skipped') problems.push(`${target} skipped "${test.id}"`);
        else if (test.status === 'unexpected') problems.push(`${target} failed "${test.id}"`);
        else if (test.status === 'flaky') problems.push(`${target} was flaky on "${test.id}" (it needed a retry)`);
      }
    }
  }

  problems.push(...groupOnlyProblems(listed, groups));
  return { totals, problems };
}

/**
 * A test listed for one group's targets and none of another's must carry that group's tag
 * (`@<group>`) and a one-line reason (annotation type "group-only"); a tagged test must not be
 * listed for any other group.
 */
function groupOnlyProblems(listed: Map<string, TargetTests>, groups: Record<string, string[]>): string[] {
  const problems: string[] = [];
  const byId = new Map<string, { test: ReportedTest; groups: Set<string> }>();
  for (const [group, targets] of Object.entries(groups)) {
    for (const target of targets) {
      for (const test of listed.get(target)?.tests ?? []) {
        const entry = byId.get(test.id) ?? { test, groups: new Set<string>() };
        entry.groups.add(group);
        byId.set(test.id, entry);
      }
    }
  }
  const all = Object.keys(groups);
  for (const [id, { test, groups: inGroups }] of byId) {
    const tagged = all.filter((group) => test.tags.includes(`@${group}`));
    const reason = test.annotations.find((a) => a.type === 'group-only')?.description?.trim() ?? '';
    for (const group of tagged) {
      if (reason === '') problems.push(`"${id}" is tagged @${group} but gives no group-only reason (annotation type "group-only")`);
      for (const other of all) {
        if (other !== group && inGroups.has(other)) problems.push(`"${id}" is tagged @${group} but is also listed for the ${other} group`);
      }
    }
    if (tagged.length === 0 && inGroups.size < all.length) {
      for (const group of inGroups)
        problems.push(`"${id}" runs in the ${group} group only but has no @${group} tag with a group-only reason`);
    }
  }
  return problems;
}
