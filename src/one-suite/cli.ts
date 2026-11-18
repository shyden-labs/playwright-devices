#!/usr/bin/env node
/**
 * The one-suite checks from the command line (shyden-labs/playwright-devices#16 AC 7):
 *
 *   one-suite --group phones=ios-webkit,android-cdp --group desktop=chromium,firefox,webkit,msedge \
 *     --list desktop-list.json --list ios-list.json=ios-webkit --list android-list.json=android-cdp \
 *     --report desktop.json --report ios.json=ios-webkit --report android.json=android-cdp \
 *     [--assertions desktop-assertions.json --assertions ios-assertions.json ...]
 *
 * `--list` takes `playwright test --list --reporter=json` output and `--report` a JSON report; a
 * `=target` suffix names a file whose project has no name (a device run). Prints one total per
 * target, then every problem, and exits 1 on any problem.
 */
import { readFileSync } from 'node:fs';
import type { JSONReport } from '@playwright/test/reporter';
import { runIfEntry } from '../../scripts/cli.ts';
import { checkOneSuite, testsByTarget, type TargetTests } from './check.ts';

export interface NamedFile {
  file: string;
  /** The target for a project with no name; empty when the file's projects are named. */
  target: string;
}

export interface Args {
  lists: NamedFile[];
  reports: NamedFile[];
  assertions: string[];
  groups: Record<string, string[]>;
}

export interface Io {
  read: (file: string) => string;
  log: (line: string) => void;
  error: (line: string) => void;
}

const USAGE = 'usage: one-suite --group <name>=<target>,... --list <file>[=<target>] --report <file>[=<target>] [--assertions <file>]';

const FLAGS = new Set(['--list', '--report', '--assertions', '--group']);

/** Adds one flag's value to the arguments read so far. */
function addArg(args: Args, flag: string, value: string): void {
  const [left = '', right = ''] = value.split('=');
  if (flag === '--group') {
    const targets = right.split(',').filter((t) => t !== '');
    if (left === '' || targets.length === 0) throw new Error(`--group needs name=target,target: "${value}"`);
    args.groups[left] = targets;
  } else if (flag === '--assertions') args.assertions.push(value);
  else (flag === '--list' ? args.lists : args.reports).push({ file: left, target: right });
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { lists: [], reports: [], assertions: [], groups: {} };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = String(argv[i]);
    const value = argv[i + 1];
    if (!FLAGS.has(flag)) throw new Error(`unknown argument "${flag}"`);
    if (value === undefined) throw new Error(`${flag} needs a value`);
    addArg(args, flag, value);
  }
  if (Object.keys(args.groups).length === 0 || args.lists.length === 0 || args.reports.length === 0) throw new Error(USAGE);
  return args;
}

export const defaultIo: Io = { read: (file) => readFileSync(file, 'utf8'), log: console.log, error: console.error };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function readJson(io: Io, file: string): unknown {
  try {
    return JSON.parse(io.read(file));
  } catch (error) {
    throw new Error(`cannot read ${file}: ${messageOf(error)}`, { cause: error });
  }
}

function targetsOf(io: Io, files: NamedFile[]): Map<string, TargetTests> {
  return new Map(files.flatMap(({ file, target }) => [...testsByTarget(readJson(io, file) as JSONReport, target)]));
}

export function main(argv: string[], io: Io = defaultIo): number {
  try {
    const args = parseArgs(argv);
    const listed = targetsOf(io, args.lists);
    const ran = targetsOf(io, args.reports);
    const assertions =
      args.assertions.length === 0
        ? undefined
        : (Object.assign({}, ...args.assertions.map((file) => readJson(io, file))) as Record<string, Record<string, number>>);
    const { totals, problems } = checkOneSuite({ listed, ran, groups: args.groups, ...(assertions === undefined ? {} : { assertions }) });
    for (const line of totals) io.log(`one-suite: ${line}`);
    for (const line of problems) io.error(`one-suite: ${line}`);
    return problems.length === 0 ? 0 : 1;
  } catch (error) {
    io.error(`one-suite: ${messageOf(error)}`);
    return 1;
  }
}

await runIfEntry(import.meta.url, main);
