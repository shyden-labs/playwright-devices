/**
 * A Playwright reporter counting the `expect` assertions each test ran, per target, failed ones
 * included (shyden-labs/playwright-devices#16 AC 5). Playwright's JSON report does not record
 * expect steps, so a test that checks less on one target than another would otherwise pass unseen.
 *
 *   reporter: [['@shyden-labs/playwright-devices/one-suite/assertion-counter', { outputFile: 'assertions.json', unnamedTarget: 'ios-webkit' }]]
 *
 * The file maps each target to each test's count: { "<target>": { "<file> › <title path>": n } }.
 * `unnamedTarget` names a run whose project has no name (a device run).
 */
import { writeFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

export interface AssertionCounterOptions {
  outputFile: string;
  unnamedTarget: string;
}

export type WriteFile = (file: string, body: string) => void;

export class AssertionCounter implements Reporter {
  private readonly counts = new Map<string, Map<string, number>>();

  private readonly options: AssertionCounterOptions;
  private readonly write: WriteFile;

  constructor(options: AssertionCounterOptions, write: WriteFile = writeFileSync) {
    if (typeof options.outputFile !== 'string' || options.outputFile === '') throw new Error('AssertionCounter needs an outputFile option');
    this.options = options;
    this.write = write;
  }

  private entry(test: TestCase): { target: Map<string, number>; id: string } {
    const [, project = '', ...path] = test.titlePath();
    const name = project === '' ? this.options.unnamedTarget : project;
    const target = this.counts.get(name) ?? new Map<string, number>();
    this.counts.set(name, target);
    return { target, id: path.join(' › ') };
  }

  onTestEnd(test: TestCase): void {
    const { target, id } = this.entry(test);
    target.set(id, target.get(id) ?? 0);
  }

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep): void {
    if (step.category !== 'expect') return;
    const { target, id } = this.entry(test);
    target.set(id, (target.get(id) ?? 0) + 1);
  }

  onEnd(): void {
    const json = Object.fromEntries([...this.counts].map(([target, tests]) => [target, Object.fromEntries(tests)]));
    this.write(this.options.outputFile, `${JSON.stringify(json, null, 2)}\n`);
  }

  printsToStdio(): boolean {
    return false;
  }
}

export default AssertionCounter;
