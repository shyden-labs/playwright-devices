import { describe, expect, it } from 'vitest';
import { defaultIo, main, parseArgs } from '../../src/one-suite/cli.ts';

const report = (projects: string[], titles: string[], status = 'expected') =>
  JSON.stringify({
    config: { projects: projects.map((name) => ({ name })) },
    suites: [
      {
        title: 'a.spec.ts',
        file: 'a.spec.ts',
        specs: titles.map((title) => ({
          title,
          file: 'a.spec.ts',
          tags: [],
          tests: projects.map((projectName) => ({ projectName, annotations: [], status })),
        })),
      },
    ],
  });

function run(args: string[], files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const read = (file: string) => {
    const body = files[file];
    if (body === undefined) throw new Error(`ENOENT: ${file}`);
    return body;
  };
  const code = main(args, { read, log: (line) => out.push(line), error: (line) => err.push(line) });
  return { code, out, err };
}

describe('parseArgs', () => {
  it('reads lists, reports, assertions and groups, each repeatable, with an optional =target', () => {
    expect(
      parseArgs([
        '--list',
        'list.json',
        '--list',
        'phone-list.json=ios-webkit',
        '--report',
        'run.json',
        '--group',
        'desktop=chromium,firefox',
        '--assertions',
        'a.json',
      ]),
    ).toEqual({
      lists: [
        { file: 'list.json', target: '' },
        { file: 'phone-list.json', target: 'ios-webkit' },
      ],
      reports: [{ file: 'run.json', target: '' }],
      assertions: ['a.json'],
      groups: { desktop: ['chromium', 'firefox'] },
    });
  });

  it('refuses an unknown flag, a flag with no value, and a group with no targets, naming each', () => {
    expect(() => parseArgs(['--bogus', 'x'])).toThrow('unknown argument "--bogus"');
    expect(() => parseArgs(['--list'])).toThrow('--list needs a value');
    expect(() => parseArgs(['--group', 'desktop='])).toThrow('--group needs name=target,target: "desktop="');
  });

  it('refuses a run with no group, no list or no report', () => {
    expect(() => parseArgs(['--list', 'l.json', '--report', 'r.json'])).toThrow('usage: one-suite');
    expect(() => parseArgs(['--group', 'd=chromium', '--report', 'r.json'])).toThrow('usage: one-suite');
    expect(() => parseArgs(['--group', 'd=chromium', '--list', 'l.json'])).toThrow('usage: one-suite');
  });
});

describe('main', () => {
  const files = {
    'list.json': report(['chromium', 'firefox'], ['reads', 'taps']),
    'run.json': report(['chromium', 'firefox'], ['reads', 'taps']),
  };
  const args = ['--list', 'list.json', '--report', 'run.json', '--group', 'desktop=chromium,firefox'];

  it('prints one total per target and passes when every check holds', () => {
    expect(run(args, files)).toEqual({ code: 0, out: ['one-suite: chromium: 2 tests', 'one-suite: firefox: 2 tests'], err: [] });
  });

  it('prints the totals and every problem, and fails', () => {
    const failing = { ...files, 'run.json': report(['chromium', 'firefox'], ['reads', 'taps'], 'skipped') };
    expect(run(args, failing)).toEqual({
      code: 1,
      out: ['one-suite: chromium: 2 tests', 'one-suite: firefox: 2 tests'],
      err: [
        'one-suite: chromium skipped "a.spec.ts › reads"',
        'one-suite: chromium skipped "a.spec.ts › taps"',
        'one-suite: firefox skipped "a.spec.ts › reads"',
        'one-suite: firefox skipped "a.spec.ts › taps"',
      ],
    });
  });

  it('merges the assertion files and checks them', () => {
    const withCounts = {
      ...files,
      'a1.json': JSON.stringify({ chromium: { 'a.spec.ts › reads': 3, 'a.spec.ts › taps': 1 } }),
      'a2.json': JSON.stringify({ firefox: { 'a.spec.ts › reads': 2, 'a.spec.ts › taps': 1 } }),
    };
    expect(run([...args, '--assertions', 'a1.json', '--assertions', 'a2.json'], withCounts).err).toEqual([
      'one-suite: assertions in "a.spec.ts › reads" differ in the desktop group: chromium 3, firefox 2',
    ]);
  });

  it('fails closed, naming the file, when a report cannot be read or is not JSON', () => {
    expect(run(args, { 'list.json': files['list.json'] })).toEqual({
      code: 1,
      out: [],
      err: ['one-suite: cannot read run.json: ENOENT: run.json'],
    });
    expect(run(args, { ...files, 'run.json': 'not json' }).err[0]).toMatch(/^one-suite: cannot read run\.json: .*JSON/);
  });

  it('names what a reader threw even when it is not an Error', () => {
    const code = main(args, {
      read: () => {
        throw 'disk gone'; // eslint-disable-line @typescript-eslint/only-throw-error -- a reader that throws a plain value
      },
      log: () => undefined,
      error: (line) => {
        expect(line).toBe('one-suite: cannot read list.json: disk gone');
      },
    });
    expect(code).toBe(1);
  });

  it('prints the usage and fails on bad arguments', () => {
    expect(run(['--bogus'], files)).toEqual({ code: 1, out: [], err: ['one-suite: unknown argument "--bogus"'] });
  });
});

describe('defaultIo', () => {
  it('reads a file as text', () => {
    expect(JSON.parse(defaultIo.read('tests/fixtures/one-suite/android-playwright-report.json'))).toHaveProperty('suites');
  });
});
