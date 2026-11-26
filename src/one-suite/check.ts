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
  /** Each target's expect count per test, from the AssertionCounter reporter; checked when given. */
  assertions?: Record<string, Record<string, number>>;
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
    // An untitled describe adds nothing to the id, as in Playwright's titlePath, which the assertion counter reads.
    for (const child of suite.suites ?? []) visit(child, child.title === '' ? path : [...path, child.title]);
  };
  for (const file of report.suites) visit(file, [file.file]);
  return targets;
}

const ids = (target: TargetTests | undefined): Set<string> => new Set(target?.tests.map((t) => t.id));

/** What one target ran against what was listed for it: missing, extra, skipped, failed and flaky tests. */
function runProblems(target: string, expected: TargetTests, run: TargetTests): string[] {
  const problems: string[] = [];
  const listedIds = ids(expected);
  const ranIds = ids(run);
  for (const id of listedIds) if (!ranIds.has(id)) problems.push(`${target} did not run "${id}" (listed for it)`);
  const byStatus: Partial<Record<ReportedTest['status'], (id: string) => string>> = {
    skipped: (id) => `${target} skipped "${id}"`,
    unexpected: (id) => `${target} failed "${id}"`,
    flaky: (id) => `${target} was flaky on "${id}" (it needed a retry)`,
  };
  for (const test of run.tests) {
    const reportStatus = byStatus[test.status];
    if (!listedIds.has(test.id)) problems.push(`${target} ran "${test.id}", which is not listed for it`);
    else if (reportStatus !== undefined) problems.push(reportStatus(test.id));
  }
  return problems;
}

/** The targets of one group: listed alike, each with a total, each run held to its list. */
function groupProblems(
  group: string,
  targets: string[],
  listed: Map<string, TargetTests>,
  ran: Map<string, TargetTests>,
  totals: string[],
): string[] {
  const problems: string[] = [];
  const withList = targets.filter((t) => listed.has(t));
  const sets = withList.map((t) => [...ids(listed.get(t))].sort((x, y) => x.localeCompare(y)).join('\n'));
  if (new Set(sets).size > 1) {
    const listedTotals = withList.map((t) => `${t} ${String(ids(listed.get(t)).size)}`).join(', ');
    problems.push(`the ${group} group is listed different tests: ${listedTotals}`);
  }
  for (const target of targets) {
    const expected = listed.get(target);
    if (expected === undefined) {
      problems.push(`${target} has no listed tests: pass its --list report`);
      continue;
    }
    const run = ran.get(target);
    totals.push(`${target}: ${String(run?.tests.length ?? 0)} tests`);
    if (run === undefined || run.tests.length === 0) problems.push(`${target} ran no tests (it is in the ${group} group)`);
    else problems.push(...runProblems(target, expected, run));
  }
  return problems;
}

export function checkOneSuite({ listed, ran, groups, assertions }: OneSuiteInput): OneSuiteResult {
  const totals: string[] = [];
  const declared = new Set(Object.values(groups).flat());
  const problems = [...new Set([...listed.keys(), ...ran.keys()])]
    .filter((t) => !declared.has(t))
    .map((t) => `${t} is in no declared group`);
  for (const [group, targets] of Object.entries(groups)) problems.push(...groupProblems(group, targets, listed, ran, totals));
  problems.push(...groupOnlyProblems(listed, groups));
  if (assertions !== undefined) problems.push(...assertionProblems(listed, groups, assertions));
  return { totals, problems };
}

/** Each listed test must have counted the same number of assertions on every target in its group. */
function assertionProblems(
  listed: Map<string, TargetTests>,
  groups: Record<string, string[]>,
  assertions: Record<string, Record<string, number>>,
): string[] {
  const problems: string[] = [];
  for (const [group, targets] of Object.entries(groups)) {
    const testIds = new Set(targets.flatMap((target) => [...ids(listed.get(target))]));
    for (const id of testIds) {
      const counted: [target: string, count: number][] = [];
      for (const target of targets.filter((t) => ids(listed.get(t)).has(id))) {
        const count = assertions[target]?.[id];
        if (count === undefined) problems.push(`${target} counted no assertions for "${id}": pass its --assertions file`);
        else counted.push([target, count]);
      }
      if (new Set(counted.map(([, count]) => count)).size > 1) {
        const each = counted.map(([target, count]) => `${target} ${String(count)}`).join(', ');
        problems.push(`assertions in "${id}" differ in the ${group} group: ${each}`);
      }
    }
  }
  return problems;
}

/** Each listed test with the groups it is listed for. */
function testsWithGroups(
  listed: Map<string, TargetTests>,
  groups: Record<string, string[]>,
): Map<string, { test: ReportedTest; groups: Set<string> }> {
  const byId = new Map<string, { test: ReportedTest; groups: Set<string> }>();
  for (const [group, targets] of Object.entries(groups)) {
    for (const test of targets.flatMap((target) => listed.get(target)?.tests ?? [])) {
      const entry = byId.get(test.id) ?? { test, groups: new Set<string>() };
      entry.groups.add(group);
      byId.set(test.id, entry);
    }
  }
  return byId;
}

/** One test's group-only problems. */
function groupOnlyProblemsOf(id: string, test: ReportedTest, inGroups: Set<string>, all: string[]): string[] {
  // Playwright's JSON report writes tags without their '@' (shyden-labs/playwright-devices#39).
  const tagged = all.filter((group) => test.tags.includes(group));
  if (tagged.length === 0) {
    if (inGroups.size === all.length) return [];
    return [...inGroups].map((group) => `"${id}" runs in the ${group} group only but has no @${group} tag with a group-only reason`);
  }
  const reason = test.annotations.find((a) => a.type === 'group-only')?.description?.trim() ?? '';
  return tagged.flatMap((group) => [
    ...(reason === '' ? [`"${id}" is tagged @${group} but gives no group-only reason (annotation type "group-only")`] : []),
    ...all
      .filter((other) => other !== group && inGroups.has(other))
      .map((other) => `"${id}" is tagged @${group} but is also listed for the ${other} group`),
  ]);
}

/**
 * A test listed for one group's targets and none of another's must carry that group's tag
 * (`@<group>`) and a one-line reason (annotation type "group-only"); a tagged test must not be
 * listed for any other group.
 */
function groupOnlyProblems(listed: Map<string, TargetTests>, groups: Record<string, string[]>): string[] {
  const all = Object.keys(groups);
  return [...testsWithGroups(listed, groups)].flatMap(([id, { test, groups: inGroups }]) => groupOnlyProblemsOf(id, test, inGroups, all));
}
