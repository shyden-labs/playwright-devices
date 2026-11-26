import { homedir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
const nodeSpawner = {
  run: vi.fn(() => Promise.resolve({ code: 0, stdout: '', stderr: '' })),
  print: vi.fn(),
};
vi.mock('../../src/devices/cli/node-spawner.ts', () => ({ NODE_SPAWNER: nodeSpawner }));
const realStart = vi.fn<(options: StartOptions, spawner: Spawner) => Promise<number>>(() => Promise.resolve(5));
vi.mock('../../src/devices/cli/start.ts', () => ({ start: realStart }));
vi.mock('../../src/devices/cli/setup.ts', () => ({ setupIphone: vi.fn() }));

const { interruptSignal, main, run, USAGE } = await import('../../src/devices/cli/main.ts');
import type { MainDeps } from '../../src/devices/cli/main.ts';
import type { SetupOptions } from '../../src/devices/cli/setup.ts';
import type { Spawner } from '../../src/devices/cli/spawner.ts';
import type { StartOptions } from '../../src/devices/cli/start.ts';

/** Deps whose start and setup record what they were given; the spawner records runs and prints. */
function fakeDeps(env: NodeJS.ProcessEnv = { HOME: '/Users/x' }) {
  const printed: string[] = [];
  const ran: string[] = [];
  const started: StartOptions[] = [];
  const setUp: SetupOptions[] = [];
  const spawner = {
    run: (command: string, args: string[]) => {
      ran.push([command, ...args].join(' '));
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    },
    print: (line: string) => {
      printed.push(line);
    },
  } as unknown as Spawner;
  const signal = new AbortController().signal;
  const deps: MainDeps = {
    spawner,
    signal,
    env,
    now: () => new Date(2026, 10, 26, 1, 5),
    pid: 4242,
    start: (options) => {
      started.push(options);
      return Promise.resolve(7);
    },
    setupIphone: (options) => {
      setUp.push(options);
      return Promise.resolve(0);
    },
  };
  return { deps, printed, ran, started, setUp, signal };
}

describe('playwright-devices start', () => {
  it("runs the command for the iPhone, logging under the WebDriverAgent folder, and answers start's code", async () => {
    const fake = fakeDeps({ HOME: '/Users/x', PLAYWRIGHT_DEVICES_WDA_DIR: '/wda' });
    expect(await main(['start', 'iphone', 'U', '--', 'npx', 'playwright', 'test', '--project', 'iphone'], fake.deps)).toBe(7);
    expect(fake.ran).toEqual(['mkdir -p /wda/logs']);
    expect(fake.started).toEqual([
      {
        target: 'iphone',
        id: 'U',
        command: ['npx', 'playwright', 'test', '--project', 'iphone'],
        logDir: '/wda/logs',
        stamp: '2026-11-26-0105-4242',
        wdaDir: '/wda',
        env: fake.deps.env,
        signal: fake.signal,
      },
    ]);
  });

  it("keeps WebDriverAgent in this user's Library caches by default", async () => {
    const fake = fakeDeps({});
    await main(['start', 'android', 'S', '--', 'npx', 'playwright', 'test'], fake.deps);
    expect(fake.started[0]?.wdaDir).toBe(`${homedir()}/Library/Caches/playwright-devices/wda`);
    expect(fake.started[0]?.target).toBe('android');
  });

  it.each([
    [['start', 'iphone', 'U', 'npx']],
    [['start', 'iphone', 'U', '--']],
    [['start', 'ipad', 'U', '--', 'npx']],
    [['start', 'iphone']],
    [['launch']],
    [[]],
  ])('prints the usage and answers 2 for %j', async (argv) => {
    const fake = fakeDeps();
    expect(await main(argv, fake.deps)).toBe(2);
    expect(fake.printed).toEqual([USAGE]);
    expect(fake.started).toEqual([]);
  });
});

describe('playwright-devices setup', () => {
  const flags = ['--team', 'T1', '--profile', 'Example Wildcard', '--bundle', 'org.example.Runner', '--wda-source', '/src/wda'];

  it('builds WebDriverAgent for the iPhone with the flags given, in any order', async () => {
    const fake = fakeDeps({ PLAYWRIGHT_DEVICES_WDA_DIR: '/wda' });
    expect(await main(['setup', 'iphone', 'U', ...flags.slice(4), ...flags.slice(0, 4)], fake.deps)).toBe(0);
    expect(fake.setUp).toEqual([
      { udid: 'U', team: 'T1', profile: 'Example Wildcard', bundle: 'org.example.Runner', wdaSource: '/src/wda', wdaDir: '/wda' },
    ]);
  });

  it.each([[flags.slice(2)], [[...flags, '--colour', 'red']], [[...flags.slice(0, -1)]], [[...flags, '--team', 'T2']]])(
    'prints the usage and answers 2 when the flags are %j',
    async (given) => {
      const fake = fakeDeps();
      expect(await main(['setup', 'iphone', 'U', ...given], fake.deps)).toBe(2);
      expect(fake.printed).toEqual([USAGE]);
      expect(fake.setUp).toEqual([]);
    },
  );

  it('refuses setup for anything but the iPhone', async () => {
    const fake = fakeDeps();
    expect(await main(['setup', 'android', 'S', ...flags], fake.deps)).toBe(2);
  });
});

describe('interruptSignal', () => {
  afterEach(() => {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it.each(['SIGINT', 'SIGTERM'] as const)('aborts on %s', (name) => {
    const signal = interruptSignal();
    expect(signal.aborted).toBe(false);
    process.emit(name);
    expect(signal.aborted).toBe(true);
  });
});

describe('the usage line', () => {
  it('names both commands and every flag', () => {
    expect(USAGE).toBe(
      'usage: playwright-devices setup iphone <udid> --team <id> --profile <name> --bundle <id> --wda-source <dir> | start iphone <udid> -- <command...> | start android <serial> -- <command...>',
    );
  });
});

describe('run, the installed command', () => {
  afterEach(() => {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it("wires Node's spawner, this process's environment, clock and id, and Ctrl-C", async () => {
    expect(await run(['start', 'android', 'S', '--', 'npx', 'playwright', 'test'])).toBe(5);
    const [options, spawner] = realStart.mock.calls[0] ?? [];
    expect(spawner).toBe(nodeSpawner);
    if (options === undefined) throw new Error('start was not called');
    expect(options.env).toBe(process.env);
    expect(options.stamp).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2}-\\d{4}-${process.pid}$`));
    expect(options.signal.aborted).toBe(false);
    process.emit('SIGINT');
    expect(options.signal.aborted).toBe(true);
  });
});
