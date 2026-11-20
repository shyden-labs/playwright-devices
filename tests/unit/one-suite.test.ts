import { readFileSync } from 'node:fs';
import type { JSONReport, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { describe, expect, it } from 'vitest';
import { AssertionCounter } from '../../src/one-suite/assertion-counter.ts';
import { checkOneSuite, testsByTarget, type TargetTests } from '../../src/one-suite/check.ts';

interface Made {
  title: string;
  file?: string;
  tags?: string[];
  reason?: string;
  status?: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  annotations?: { type: string; description?: string }[];
}

/** A Playwright JSON report with one spec per test, each run on every named project. */
function report(projects: string[], tests: Made[]): JSONReport {
  const specs = tests.map((t) => ({
    title: t.title,
    file: t.file ?? 'journey.spec.ts',
    tags: t.tags ?? [],
    ok: true,
    id: t.title,
    line: 1,
    column: 1,
    tests: projects.map((projectName) => ({
      projectName,
      projectId: projectName,
      timeout: 30_000,
      expectedStatus: 'passed',
      status: t.status ?? 'expected',
      annotations: [...(t.annotations ?? []), ...(t.reason === undefined ? [] : [{ type: 'group-only', description: t.reason }])],
      results: t.status === 'skipped' ? [{ status: 'skipped' }] : [{ status: t.status === 'unexpected' ? 'failed' : 'passed' }],
    })),
  }));
  return {
    config: { projects: projects.map((name) => ({ name })) },
    suites: [{ title: 'journey.spec.ts', file: 'journey.spec.ts', specs }],
  } as unknown as JSONReport;
}

const GROUPS = { phones: ['ios-webkit', 'android-cdp'], desktop: ['chromium', 'firefox'] };
const both = (made: Made[]) => ({
  listed: new Map([
    ...testsByTarget(report(['chromium', 'firefox'], made), ''),
    ...testsByTarget(report(['ios-webkit', 'android-cdp'], made), ''),
  ]),
});

function check(listedMade: Made[], ran: Map<string, TargetTests>, groups = GROUPS) {
  return checkOneSuite({ listed: both(listedMade).listed, ran, groups });
}

describe('testsByTarget', () => {
  it('reads a real device report, naming its one unnamed project by the target given', () => {
    const real = JSON.parse(readFileSync('tests/fixtures/one-suite/android-playwright-report.json', 'utf8')) as JSONReport;
    const targets = testsByTarget(real, 'android-playwright');
    expect([...targets.keys()]).toEqual(['android-playwright']);
    expect(targets.get('android-playwright')?.tests.map((t) => t.id)).toEqual([
      'journey.spec.ts › a page is read, tapped, typed into and scrolled by real input',
    ]);
  });

  it('splits a multi-project report by project name', () => {
    const targets = testsByTarget(report(['chromium', 'firefox'], [{ title: 'a' }]), 'unused');
    expect([...targets.keys()]).toEqual(['chromium', 'firefox']);
  });

  it('names a test by its file and its whole title path, nested describes included', () => {
    const nested = {
      config: { projects: [{ name: 'chromium' }] },
      suites: [
        {
          title: 'a.spec.ts',
          file: 'a.spec.ts',
          specs: [],
          suites: [
            {
              title: 'outer',
              file: 'a.spec.ts',
              specs: report(['chromium'], [{ title: 'inner', file: 'a.spec.ts' }]).suites[0]?.specs ?? [],
            },
          ],
        },
      ],
    } as unknown as JSONReport;
    expect(
      testsByTarget(nested, '')
        .get('chromium')
        ?.tests.map((t) => t.id),
    ).toEqual(['a.spec.ts › outer › inner']);
  });
});

describe('checkOneSuite', () => {
  const made = [{ title: 'reads' }, { title: 'taps' }];
  const ran = (projects: string[], tests: Made[] = made) => testsByTarget(report(projects, tests), '');

  it('passes when every target ran exactly its listed tests, and prints one total per target', () => {
    const result = check(made, new Map([...ran(['chromium', 'firefox']), ...ran(['ios-webkit', 'android-cdp'])]));
    expect(result.problems).toEqual([]);
    expect(result.totals).toEqual(['ios-webkit: 2 tests', 'android-cdp: 2 tests', 'chromium: 2 tests', 'firefox: 2 tests']);
  });

  it('holds a group run alone to the full list: names each target and test that did not run', () => {
    const result = check(made, new Map([...ran(['ios-webkit', 'android-cdp'], [{ title: 'reads' }])]));
    expect(result.problems).toEqual([
      'ios-webkit did not run "journey.spec.ts › taps" (listed for it)',
      'android-cdp did not run "journey.spec.ts › taps" (listed for it)',
      'chromium ran no tests (it is in the desktop group)',
      'firefox ran no tests (it is in the desktop group)',
    ]);
  });

  it('names a test a target ran that was not listed for it', () => {
    const extra = new Map([
      ...ran(['chromium', 'firefox']),
      ...ran(['ios-webkit', 'android-cdp']),
      ...ran(['firefox'], [...made, { title: 'extra' }]),
    ]);
    expect(check(made, extra).problems).toEqual(['firefox ran "journey.spec.ts › extra", which is not listed for it']);
  });

  it('fails every skipped test, naming its target; nothing is exempted', () => {
    const skipped = new Map([
      ...ran(['chromium', 'firefox']),
      ...ran(['ios-webkit', 'android-cdp']),
      ...ran(['ios-webkit'], [{ title: 'reads' }, { title: 'taps', status: 'skipped' }]),
    ]);
    expect(check(made, skipped).problems).toEqual(['ios-webkit skipped "journey.spec.ts › taps"']);
  });

  it('fails a failed or flaky test, named per target', () => {
    const bad = new Map([
      ...ran(['chromium', 'ios-webkit', 'android-cdp']),
      ...ran(
        ['firefox'],
        [
          { title: 'reads', status: 'unexpected' },
          { title: 'taps', status: 'flaky' },
        ],
      ),
    ]);
    expect(check(made, bad).problems).toEqual([
      'firefox failed "journey.spec.ts › reads"',
      'firefox was flaky on "journey.spec.ts › taps" (it needed a retry)',
    ]);
  });

  it('fails a group whose targets are listed different tests, naming the totals', () => {
    const listed = new Map([...both(made).listed, ...testsByTarget(report(['firefox'], [{ title: 'reads' }]), '')]);
    const result = checkOneSuite({
      listed,
      ran: new Map([...ran(['chromium', 'ios-webkit', 'android-cdp']), ...ran(['firefox'], [{ title: 'reads' }])]),
      groups: GROUPS,
    });
    expect(result.problems).toEqual(['the desktop group is listed different tests: chromium 2, firefox 1']);
  });

  it('refuses a target in no declared group, and a declared target with no list', () => {
    const result = checkOneSuite({
      listed: testsByTarget(report(['chromium', 'opera'], made), ''),
      ran: ran(['chromium', 'opera']),
      groups: { desktop: ['chromium', 'edge'] },
    });
    expect(result.problems).toEqual(['opera is in no declared group', 'edge has no listed tests: pass its --list report']);
  });
});

describe('group-only tests', () => {
  // Tags as Playwright's JSON reporter writes them: without the '@' (playwright 1.65.1,
  // lib/runner/index.js _serializeTestSpec: `tags: test.tags.map((tag) => tag.substring(1))`).
  const groupOnly = (tags: string[], reason?: string): Made[] => [
    { title: 'reads' },
    { title: 'pinches', tags, ...(reason === undefined ? {} : { reason }) },
  ];

  function listedSplit(phoneTests: Made[], desktopTests: Made[]) {
    return new Map([
      ...testsByTarget(report(['chromium', 'firefox'], desktopTests), ''),
      ...testsByTarget(report(['ios-webkit', 'android-cdp'], phoneTests), ''),
    ]);
  }

  it('passes a test listed for one group only when it carries that group tag and a reason', () => {
    const phones = groupOnly(['phones'], 'pinch-zoom needs a touch screen');
    const listed = listedSplit(phones, [{ title: 'reads' }]);
    const result = checkOneSuite({ listed, ran: listed, groups: GROUPS });
    expect(result.problems).toEqual([]);
  });

  it('fails a test listed for one group only with no group tag, naming it', () => {
    const listed = listedSplit(groupOnly([]), [{ title: 'reads' }]);
    expect(checkOneSuite({ listed, ran: listed, groups: GROUPS }).problems).toEqual([
      '"journey.spec.ts › pinches" runs in the phones group only but has no @phones tag with a group-only reason',
    ]);
  });

  it('fails a group tag with no reason, or an empty one', () => {
    for (const reason of [undefined, '  ']) {
      const listed = listedSplit(groupOnly(['phones'], reason), [{ title: 'reads' }]);
      expect(checkOneSuite({ listed, ran: listed, groups: GROUPS }).problems).toEqual([
        '"journey.spec.ts › pinches" is tagged @phones but gives no group-only reason (annotation type "group-only")',
      ]);
    }
  });

  it('fails a test tagged for one group that is also listed for another', () => {
    const tagged = groupOnly(['phones'], 'touch only');
    const listed = listedSplit(tagged, tagged);
    expect(checkOneSuite({ listed, ran: listed, groups: GROUPS }).problems).toEqual([
      '"journey.spec.ts › pinches" is tagged @phones but is also listed for the desktop group',
    ]);
  });
});

describe('assertion counts', () => {
  const made = [{ title: 'reads' }];
  const listed = () => both(made).listed;
  const counts = (n: Record<string, number>) =>
    Object.fromEntries(Object.entries(n).map(([target, count]) => [target, { 'journey.spec.ts › reads': count }]));

  it('passes when every target in a group counted the same assertions for each test', () => {
    const result = checkOneSuite({
      listed: listed(),
      ran: listed(),
      groups: GROUPS,
      assertions: counts({ 'ios-webkit': 9, 'android-cdp': 9, chromium: 7, firefox: 7 }),
    });
    expect(result.problems).toEqual([]);
  });

  it('names a test whose count differs between targets in a group, with every count', () => {
    const result = checkOneSuite({
      listed: listed(),
      ran: listed(),
      groups: GROUPS,
      assertions: counts({ 'ios-webkit': 9, 'android-cdp': 6, chromium: 7, firefox: 7 }),
    });
    expect(result.problems).toEqual(['assertions in "journey.spec.ts › reads" differ in the phones group: ios-webkit 9, android-cdp 6']);
  });

  it('names a target that counted no assertions for a test it was listed', () => {
    const result = checkOneSuite({
      listed: listed(),
      ran: listed(),
      groups: GROUPS,
      assertions: counts({ 'ios-webkit': 9, chromium: 7, firefox: 7 }),
    });
    expect(result.problems).toEqual(['android-cdp counted no assertions for "journey.spec.ts › reads": pass its --assertions file']);
  });
});

describe('AssertionCounter', () => {
  const testCase = (project: string, path: string[]) => ({ titlePath: () => ['', project, ...path] }) as unknown as TestCase;
  const step = (category: string) => ({ category }) as unknown as TestStep;

  it('counts every expect step per target and test, failed ones included, and writes them on end', () => {
    const written: { file: string; body: string }[] = [];
    const counter = new AssertionCounter({ outputFile: 'counts.json', unnamedTarget: 'ios-webkit' }, (file, body) =>
      written.push({ file, body }),
    );
    const reads = testCase('', ['journey.spec.ts', 'reads']);
    counter.onStepEnd(reads, {} as TestResult, step('expect'));
    counter.onStepEnd(reads, {} as TestResult, step('expect'));
    counter.onStepEnd(reads, {} as TestResult, step('pw:api'));
    counter.onStepEnd(testCase('chromium', ['journey.spec.ts', 'outer', 'reads']), {} as TestResult, step('expect'));
    counter.onEnd();
    expect(written).toEqual([
      {
        file: 'counts.json',
        body: `${JSON.stringify({ 'ios-webkit': { 'journey.spec.ts › reads': 2 }, chromium: { 'journey.spec.ts › outer › reads': 1 } }, null, 2)}\n`,
      },
    ]);
  });

  it('counts a test that made no assertion as 0, so it is not mistaken for a missing count', () => {
    const written: string[] = [];
    const counter = new AssertionCounter({ outputFile: 'c.json', unnamedTarget: 'x' }, (_file, body) => written.push(body));
    counter.onTestEnd(testCase('chromium', ['a.spec.ts', 'quiet']));
    counter.onEnd();
    expect(JSON.parse(written[0] ?? '{}')).toEqual({ chromium: { 'a.spec.ts › quiet': 0 } });
  });

  it('says it prints nothing to the terminal, so Playwright keeps a terminal reporter beside it', () => {
    expect(new AssertionCounter({ outputFile: 'c.json', unnamedTarget: 'x' }, () => undefined).printsToStdio()).toBe(false);
  });

  it('refuses to start without an output file', () => {
    expect(() => new AssertionCounter({ unnamedTarget: 'x' } as never)).toThrow('AssertionCounter needs an outputFile option');
  });
});
