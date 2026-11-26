#!/usr/bin/env node
/**
 * The `playwright-devices` command (shyden-labs/playwright-devices#54):
 *
 *   playwright-devices setup iphone <udid> --team <id> --profile <name> --bundle <id> --wda-source <dir>
 *   playwright-devices start iphone <udid> -- <command...>
 *   playwright-devices start android <serial> -- <command...>
 *
 * WebDriverAgent's build and every launch's log live in
 * ~/Library/Caches/playwright-devices/wda, or PLAYWRIGHT_DEVICES_WDA_DIR.
 */
import { homedir } from 'node:os';
import { runIfEntry } from '../../../scripts/cli.ts';
import { NODE_SPAWNER } from './node-spawner.ts';
import { setupIphone, type SetupOptions } from './setup.ts';
import type { Spawner } from './spawner.ts';
import { start, type StartOptions } from './start.ts';

export const USAGE =
  'usage: playwright-devices setup iphone <udid> --team <id> --profile <name> --bundle <id> --wda-source <dir> | start iphone <udid> -- <command...> | start android <serial> -- <command...>';

/** Everything `main` reaches outside its arguments. */
export interface MainDeps {
  spawner: Spawner;
  signal: AbortSignal;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  pid: number;
  start: (options: StartOptions, spawner: Spawner) => Promise<number>;
  setupIphone: (options: SetupOptions, spawner: Spawner) => Promise<number>;
}

/** A signal aborted by Ctrl-C or SIGTERM, so `start` stops what it started. */
export function interruptSignal(): AbortSignal {
  const controller = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM'] as const) {
    process.once(name, () => {
      controller.abort();
    });
  }
  return controller.signal;
}

/** `2026-11-26-0105`, in local time: names one run's logs with the process id. */
function minuteStamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}`;
}

const SETUP_FLAGS = { '--team': 'team', '--profile': 'profile', '--bundle': 'bundle', '--wda-source': 'wdaSource' } as const;

/** The setup flags, each given once with a value; undefined for anything else. */
function setupFlags(args: string[]): Pick<SetupOptions, 'team' | 'profile' | 'bundle' | 'wdaSource'> | undefined {
  const found: Partial<Record<(typeof SETUP_FLAGS)[keyof typeof SETUP_FLAGS], string>> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = SETUP_FLAGS[args[i] as keyof typeof SETUP_FLAGS] as (typeof SETUP_FLAGS)[keyof typeof SETUP_FLAGS] | undefined;
    const value = args[i + 1];
    if (key === undefined || value === undefined || key in found) return undefined;
    found[key] = value;
  }
  const { team, profile, bundle, wdaSource } = found;
  if (team === undefined || profile === undefined || bundle === undefined || wdaSource === undefined) return undefined;
  return { team, profile, bundle, wdaSource };
}

export async function main(argv: string[], deps: MainDeps): Promise<number> {
  const [verb, target, id, ...rest] = argv;
  const wdaDir = deps.env.PLAYWRIGHT_DEVICES_WDA_DIR ?? `${homedir()}/Library/Caches/playwright-devices/wda`;
  if (verb === 'start' && (target === 'iphone' || target === 'android') && id !== undefined && rest[0] === '--' && rest.length > 1) {
    const logDir = `${wdaDir}/logs`;
    await deps.spawner.run('mkdir', ['-p', logDir]);
    const stamp = `${minuteStamp(deps.now())}-${deps.pid}`;
    const options: StartOptions = { target, id, command: rest.slice(1), logDir, stamp, wdaDir, env: deps.env, signal: deps.signal };
    return deps.start(options, deps.spawner);
  }
  const flags = verb === 'setup' && target === 'iphone' && id !== undefined ? setupFlags(rest) : undefined;
  if (flags !== undefined && id !== undefined) return deps.setupIphone({ udid: id, ...flags, wdaDir }, deps.spawner);
  deps.spawner.print(USAGE);
  return 2;
}

/** The installed command: Node's spawner, this process's environment, clock and id, and Ctrl-C. */
export function run(argv: string[]): Promise<number> {
  return main(argv, {
    spawner: NODE_SPAWNER,
    signal: interruptSignal(),
    env: process.env,
    now: () => new Date(),
    pid: process.pid,
    start,
    setupIphone,
  });
}

await runIfEntry(import.meta.url, run);
