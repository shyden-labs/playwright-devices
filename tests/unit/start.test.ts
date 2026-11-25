import { describe, expect, it } from 'vitest';
import { start, type StartOptions } from '../../src/devices/cli/start.ts';
import type { Spawned, Spawner } from '../../src/devices/cli/spawner.ts';

interface Script {
  /** stdout of `lsof` for each port; empty means free. */
  held?: Record<number, string>;
  pfConf?: string | null;
  launchctl?: string;
  setupJson?: string | null;
  /** The look at /status from which WebDriverAgent answers ready; Infinity for never. */
  wdaReadyFromLook?: number;
  /** When set, xcodebuild exits with this code at this many ms. */
  wdaExits?: { code: number; atMs: number };
  wdaLog?: string;
  iwdpReady?: boolean;
  adbDevices?: string;
  commandCode?: number;
  /** Aborts the run when the clock reaches this many ms. */
  abortAtMs?: number;
}

/** A Spawner that records every call in order and answers from `script`; its clock moves only when start sleeps. */
function fakeSpawner(script: Script) {
  const calls: string[] = [];
  const printed: string[] = [];
  const killed: string[] = [];
  const controller = new AbortController();
  let now = 0;
  let statusLooks = 0;
  const spawned: { name: string; settle: (code: number) => void }[] = [];
  const spawner: Spawner = {
    spawn(command, args, options) {
      calls.push(`spawn ${[command, ...args].join(' ')}${options.logFile === undefined ? '' : ` > ${options.logFile}`}`);
      if (options.env !== undefined) {
        const keys = ['PLAYWRIGHT_DEVICES_TARGET', 'IOS_UDID', 'IOS_RUNNER_ID', 'ANDROID_SERIAL'];
        calls.push(`  env ${keys.map((key) => `${key}=${options.env?.[key] ?? '-'}`).join(' ')}`);
      }
      let settle: (code: number) => void = () => undefined;
      const exited = new Promise<number>((resolve) => {
        settle = resolve;
      });
      const isCommand = options.inherit === true;
      if (isCommand && script.abortAtMs === undefined) settle(script.commandCode ?? 0);
      if (command === 'xcodebuild' && script.wdaExits !== undefined) spawned.push({ name: 'wda-exit', settle });
      spawned.push({ name: command, settle });
      const handle: Spawned = {
        pid: 100 + spawned.length,
        exited,
        kill: () => {
          killed.push(command);
          settle(143);
        },
      };
      return handle;
    },
    run(command, args) {
      calls.push(`run ${[command, ...args].join(' ')}`);
      if (command === 'lsof') {
        const port = Number(/-iTCP:(\d+)/.exec(args.join(' '))?.[1]);
        const holder = script.held?.[port];
        return Promise.resolve({ code: holder === undefined ? 1 : 0, stdout: holder === undefined ? '' : `COMMAND PID\n${holder}\n` });
      }
      if (command === 'launchctl') return Promise.resolve({ code: 0, stdout: script.launchctl ?? 'state = running\nlast exit code = 0\n' });
      if (command === 'adb') return Promise.resolve({ code: 0, stdout: script.adbDevices ?? 'List of devices attached\nS\tdevice\n\n' });
      return Promise.resolve({ code: 0, stdout: '' });
    },
    request(method, url, body) {
      calls.push(`${method} ${url}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`);
      if (url.endsWith('/status')) {
        statusLooks += 1;
        return Promise.resolve(statusLooks >= (script.wdaReadyFromLook ?? 1) ? '{"value":{"ready":true},"ready":true}' : null);
      }
      if (method === 'POST' && url.endsWith('/session')) return Promise.resolve('{"sessionId":"s1","value":{"sessionId":"s1"}}');
      if (url.endsWith('/json')) return Promise.resolve(script.iwdpReady === false ? '[]' : '[{"webSocketDebuggerUrl":"ws://x"}]');
      return Promise.resolve('{}');
    },
    readFile(path) {
      if (path === '/etc/pf.shyden.conf') {
        const conf = script.pfConf === undefined ? 'block in quick proto tcp to port 9221:9322' : script.pfConf;
        return conf === null ? Promise.reject(new Error('ENOENT')) : Promise.resolve(conf);
      }
      if (path.endsWith('setup.json')) {
        const json =
          script.setupJson === undefined ? '{"team":"T","profile":"P","bundle":"org.example.Runner","builtAt":"x"}' : script.setupJson;
        return json === null ? Promise.reject(new Error('ENOENT')) : Promise.resolve(json);
      }
      return Promise.resolve(script.wdaLog ?? '');
    },
    sleep(ms) {
      now += ms;
      if (script.wdaExits !== undefined && now >= script.wdaExits.atMs)
        spawned.find((s) => s.name === 'wda-exit')?.settle(script.wdaExits.code);
      if (script.abortAtMs !== undefined && now >= script.abortAtMs) controller.abort();
      if (now > 600_000) return Promise.reject(new Error('slept past 10 minutes: a wait has no ceiling'));
      return Promise.resolve();
    },
    now: () => now,
    print(line) {
      printed.push(line);
    },
  };
  return { spawner, calls, printed, killed, signal: controller.signal, clock: () => now };
}

function options(over: Partial<StartOptions>, signal: AbortSignal): StartOptions {
  return {
    target: 'iphone',
    id: 'U',
    command: ['npx', 'playwright', 'test'],
    logDir: '/logs',
    stamp: '2026-11-26-0100-42',
    wdaDir: '/wda',
    env: { PATH: '/bin' },
    signal,
    ...over,
  };
}

describe('start iphone', () => {
  it('starts iproxy, WebDriverAgent and the Safari proxy, opens one tab, runs the command, then stops them in reverse', async () => {
    const fake = fakeSpawner({});
    const code = await start(options({}, fake.signal), fake.spawner);

    expect(code).toBe(0);
    expect(fake.calls).toEqual([
      'run lsof -nP -iTCP:8100 -sTCP:LISTEN',
      'run lsof -nP -iTCP:9222 -sTCP:LISTEN',
      'run launchctl print system/uk.co.shyden.pf',
      'spawn iproxy 8100 8100 -u U > /logs/iproxy-2026-11-26-0100-42.log',
      'spawn xcodebuild test-without-building -project /wda/src/WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner -destination id=U -derivedDataPath /wda/derived > /logs/wda-2026-11-26-0100-42.log',
      'GET http://127.0.0.1:8100/status',
      'spawn ios_webkit_debug_proxy -c U:9222 > /logs/iwdp-2026-11-26-0100-42.log',
      'POST http://127.0.0.1:8100/session {"capabilities":{}}',
      'POST http://127.0.0.1:8100/session/s1/url {"url":"http://127.0.0.1:9/"}',
      'DELETE http://127.0.0.1:8100/session/s1',
      'GET http://127.0.0.1:9222/json',
      'spawn npx playwright test',
      '  env PLAYWRIGHT_DEVICES_TARGET=iphone IOS_UDID=U IOS_RUNNER_ID=org.example.Runner.xctrunner ANDROID_SERIAL=-',
    ]);
    expect(fake.killed).toEqual(['ios_webkit_debug_proxy', 'xcodebuild', 'iproxy']);
  });

  it("answers the command's own exit code, and still stops everything", async () => {
    const fake = fakeSpawner({ commandCode: 1 });
    expect(await start(options({}, fake.signal), fake.spawner)).toBe(1);
    expect(fake.killed).toEqual(['ios_webkit_debug_proxy', 'xcodebuild', 'iproxy']);
  });

  it('refuses a held port before starting anything, naming the holder', async () => {
    const fake = fakeSpawner({ held: { 8100: 'iproxy 4242 shyden 3u IPv4 TCP 127.0.0.1:8100 (LISTEN)' } });
    expect(await start(options({}, fake.signal), fake.spawner)).toBe(2);
    expect(fake.printed).toEqual(['playwright-devices: port 8100 is already held: iproxy 4242 shyden 3u IPv4 TCP 127.0.0.1:8100 (LISTEN)']);
    expect(fake.calls.filter((call) => call.startsWith('spawn'))).toEqual([]);
  });

  it('refuses to start when the port rule is missing', async () => {
    const fake = fakeSpawner({ pfConf: null });
    expect(await start(options({}, fake.signal), fake.spawner)).toBe(2);
    expect(fake.printed).toEqual(['playwright-devices: /etc/pf.shyden.conf does not block ports 9221-9322; install mac-setup/ first']);
    expect(fake.calls.filter((call) => call.startsWith('spawn'))).toEqual([]);
  });

  it('refuses to start when the port rule is not loaded', async () => {
    const fake = fakeSpawner({ launchctl: 'last exit code = 1' });
    expect(await start(options({}, fake.signal), fake.spawner)).toBe(2);
    expect(fake.printed).toEqual([
      "playwright-devices: the port rule's launchd job (uk.co.shyden.pf) has not loaded it; install mac-setup/ first",
    ]);
  });

  it('refuses to start before setup has built WebDriverAgent', async () => {
    const fake = fakeSpawner({ setupJson: null });
    expect(await start(options({}, fake.signal), fake.spawner)).toBe(2);
    expect(fake.printed).toEqual(['playwright-devices: no WebDriverAgent build in /wda; run `playwright-devices setup iphone` first']);
  });

  it("fails within 5 s of xcodebuild exiting, printing WebDriverAgent's reason and its log", async () => {
    const wdaLog = [
      'Testing started',
      'Testing failed:',
      '\tWebDriverAgentRunner-Runner (6053) encountered an error (The test runner failed to initialize for UI testing. (Underlying Error: Timed out while enabling automation mode.))',
    ].join('\n');
    const fake = fakeSpawner({ wdaReadyFromLook: Infinity, wdaExits: { code: 65, atMs: 63_000 }, wdaLog });

    expect(await start(options({}, fake.signal), fake.spawner)).toBe(2);
    expect(fake.clock()).toBeLessThanOrEqual(68_000);
    expect(fake.printed).toEqual([
      'playwright-devices: WebDriverAgent stopped (exit 65) before it answered: WebDriverAgentRunner-Runner (6053) encountered an error (The test runner failed to initialize for UI testing. (Underlying Error: Timed out while enabling automation mode.)); log: /logs/wda-2026-11-26-0100-42.log',
    ]);
    expect(fake.killed).toEqual(['xcodebuild', 'iproxy']);
  });

  it('names the log alone when it holds no failure line', async () => {
    const fake = fakeSpawner({ wdaReadyFromLook: Infinity, wdaExits: { code: 70, atMs: 5_000 }, wdaLog: 'nothing useful' });
    expect(await start(options({}, fake.signal), fake.spawner)).toBe(2);
    expect(fake.printed).toEqual([
      'playwright-devices: WebDriverAgent stopped (exit 70) before it answered; log: /logs/wda-2026-11-26-0100-42.log',
    ]);
  });

  it('fails at 180 s when WebDriverAgent never answers', async () => {
    const fake = fakeSpawner({ wdaReadyFromLook: Infinity });
    expect(await start(options({}, fake.signal), fake.spawner)).toBe(2);
    expect(fake.clock()).toBe(180_000);
    expect(fake.printed).toEqual(['playwright-devices: WebDriverAgent did not answer at http://127.0.0.1:8100/status within 180 s']);
    expect(fake.killed).toEqual(['xcodebuild', 'iproxy']);
  });

  it('fails at 30 s when Safari shows no tab through the proxy', async () => {
    const fake = fakeSpawner({ iwdpReady: false });
    expect(await start(options({}, fake.signal), fake.spawner)).toBe(2);
    expect(fake.printed).toEqual([
      'playwright-devices: ios_webkit_debug_proxy (a Safari tab) did not answer at http://127.0.0.1:9222/json within 30 s',
    ]);
    expect(fake.killed).toEqual(['ios_webkit_debug_proxy', 'xcodebuild', 'iproxy']);
  });

  it('fails naming it when WebDriverAgent opens no session to show Safari, and stops everything', async () => {
    const fake = fakeSpawner({});
    const request = fake.spawner.request.bind(fake.spawner);
    fake.spawner.request = (method, url, body) =>
      method === 'POST' && url.endsWith('/session') ? Promise.resolve(null) : request(method, url, body);
    expect(await start(options({}, fake.signal), fake.spawner)).toBe(2);
    expect(fake.printed).toEqual([
      'playwright-devices: WebDriverAgent opened no session at http://127.0.0.1:8100/session, so Safari has no tab',
    ]);
    expect(fake.killed).toEqual(['ios_webkit_debug_proxy', 'xcodebuild', 'iproxy']);
  });

  it('lets an unexpected failure through, after stopping what it started', async () => {
    const fake = fakeSpawner({});
    const spawn = fake.spawner.spawn.bind(fake.spawner);
    fake.spawner.spawn = (command, args, spawnOptions) => {
      if (command === 'xcodebuild') throw new Error('spawn xcodebuild ENOENT');
      return spawn(command, args, spawnOptions);
    };
    await expect(start(options({}, fake.signal), fake.spawner)).rejects.toThrow('spawn xcodebuild ENOENT');
    expect(fake.killed).toEqual(['iproxy']);
  });

  it('stops everything and answers 130 when interrupted while waiting for WebDriverAgent', async () => {
    const fake = fakeSpawner({ wdaReadyFromLook: Infinity, abortAtMs: 10_000 });
    expect(await start(options({}, fake.signal), fake.spawner)).toBe(130);
    expect(fake.killed).toEqual(['xcodebuild', 'iproxy']);
  });

  it('stops the command too when interrupted while it runs', async () => {
    const fake = fakeSpawner({ abortAtMs: 0 });
    const controller = new AbortController();
    const run = start(options({}, controller.signal), fake.spawner);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect(await run).toBe(130);
    expect(fake.killed).toEqual(['npx', 'ios_webkit_debug_proxy', 'xcodebuild', 'iproxy']);
  });
});

describe('start android', () => {
  it('runs the command for the listed phone with its serial', async () => {
    const fake = fakeSpawner({ commandCode: 3 });
    expect(await start(options({ target: 'android', id: 'S' }, fake.signal), fake.spawner)).toBe(3);
    expect(fake.calls).toEqual([
      'run adb devices',
      'spawn npx playwright test',
      '  env PLAYWRIGHT_DEVICES_TARGET=android IOS_UDID=- IOS_RUNNER_ID=- ANDROID_SERIAL=S',
    ]);
  });

  it('refuses a phone adb does not list as ready', async () => {
    const fake = fakeSpawner({ adbDevices: 'List of devices attached\nS\tunauthorized\n' });
    expect(await start(options({ target: 'android', id: 'S' }, fake.signal), fake.spawner)).toBe(2);
    expect(fake.printed).toEqual(['playwright-devices: adb lists no device S ready: plug it in and allow USB debugging']);
  });
});
