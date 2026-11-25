/**
 * `playwright-devices start iphone|android <id> -- <command...>`
 * (shyden-labs/playwright-devices#54): starts the phone's side, runs the
 * project's command against it, and stops everything it started, pass, fail
 * or Ctrl-C. Every wait has a ceiling and fails naming what it waited for.
 */
import type { Spawned, Spawner } from './spawner.ts';

export interface StartOptions {
  target: 'iphone' | 'android';
  /** The iPhone's UDID or the Android phone's adb serial. */
  id: string;
  command: string[];
  /** Where each started process logs, one file per launch. */
  logDir: string;
  /** Names this run's logs: its date, time and process id. */
  stamp: string;
  /** Where `playwright-devices setup iphone` built WebDriverAgent. */
  wdaDir: string;
  env: NodeJS.ProcessEnv;
  /** Aborted on Ctrl-C or SIGTERM. */
  signal: AbortSignal;
}

const WDA = 'http://127.0.0.1:8100';
const IWDP = 'http://127.0.0.1:9222';
const WDA_CEILING_S = 180;
const IWDP_CEILING_S = 30;
const POLL_MS = 1_000;
/** The exit code a shell gives a command stopped by Ctrl-C. */
const INTERRUPTED = 130;
/** The exit code for a phone side that could not start. */
const NOT_STARTED = 2;

/** A start step that failed, with the line that says why. */
class NotStarted extends Error {}

class Interrupted extends Error {}

/** The line in WebDriverAgent's log that says why it stopped. */
function failureLine(log: string): string | undefined {
  return log
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /Underlying Error|encountered an error/.test(line));
}

async function checkPorts(spawner: Spawner): Promise<void> {
  for (const port of [8100, 9222]) {
    const { stdout } = await spawner.run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
    const [holder] = stdout.split('\n').slice(1).filter(Boolean);
    if (holder !== undefined) throw new NotStarted(`port ${port} is already held: ${holder}`);
  }
}

/** ios_webkit_debug_proxy listens on every address; the pf rule in mac-setup/ keeps its ports to this Mac (shyden-labs/playwright-devices#19). */
async function checkPortRule(spawner: Spawner): Promise<void> {
  const conf = await spawner.readFile('/etc/pf.shyden.conf').catch(() => '');
  if (!conf.includes('port 9221:9322'))
    throw new NotStarted('/etc/pf.shyden.conf does not block ports 9221-9322; install mac-setup/ first');
  const { stdout } = await spawner.run('launchctl', ['print', 'system/uk.co.shyden.pf']);
  if (!stdout.includes('last exit code = 0')) {
    throw new NotStarted("the port rule's launchd job (uk.co.shyden.pf) has not loaded it; install mac-setup/ first");
  }
}

async function runnerId(spawner: Spawner, wdaDir: string): Promise<string> {
  try {
    const { bundle } = JSON.parse(await spawner.readFile(`${wdaDir}/setup.json`)) as { bundle: string };
    return `${bundle}.xctrunner`;
  } catch {
    throw new NotStarted(`no WebDriverAgent build in ${wdaDir}; run \`playwright-devices setup iphone\` first`);
  }
}

/** A run of the phone side: what it started, stopped in reverse at the end. */
function session(options: StartOptions, spawner: Spawner) {
  const started: Spawned[] = [];
  const log = (name: string) => `${options.logDir}/${name}-${options.stamp}.log`;

  function spawn(command: string, args: string[], name: string): Spawned {
    const process = spawner.spawn(command, args, { logFile: log(name) });
    started.push(process);
    return process;
  }

  /** Waits for `url` to answer with `pattern`, failing at `ceilingS` naming `what`; `stopped` fails it sooner. */
  async function waitFor(url: string, pattern: string, ceilingS: number, what: string, stopped?: () => Promise<void>): Promise<void> {
    const deadline = spawner.now() + ceilingS * 1_000;
    for (;;) {
      if (options.signal.aborted) throw new Interrupted();
      await stopped?.();
      if ((await spawner.request('GET', url))?.includes(pattern) === true) return;
      if (spawner.now() >= deadline) throw new NotStarted(`${what} did not answer at ${url} within ${ceilingS} s`);
      await spawner.sleep(POLL_MS);
    }
  }

  async function startIphone(): Promise<NodeJS.ProcessEnv> {
    const udid = options.id;
    await checkPorts(spawner);
    await checkPortRule(spawner);
    const runner = await runnerId(spawner, options.wdaDir);
    spawn('iproxy', ['8100', '8100', '-u', udid], 'iproxy');
    const wda = spawn(
      'xcodebuild',
      ['test-without-building', '-project', `${options.wdaDir}/src/WebDriverAgent.xcodeproj`, '-scheme', 'WebDriverAgentRunner'].concat([
        '-destination',
        `id=${udid}`,
        '-derivedDataPath',
        `${options.wdaDir}/derived`,
      ]),
      'wda',
    );
    let wdaExit: number | undefined;
    void wda.exited.then((code) => {
      wdaExit = code;
    });
    // shyden-labs/playwright-devices#57: a refused launch says why within a second, not after the ceiling.
    await waitFor(`${WDA}/status`, '"ready"', WDA_CEILING_S, 'WebDriverAgent', async () => {
      if (wdaExit === undefined) return;
      const reason = failureLine(await spawner.readFile(log('wda')));
      throw new NotStarted(
        `WebDriverAgent stopped (exit ${wdaExit}) before it answered${reason === undefined ? '' : `: ${reason}`}; log: ${log('wda')}`,
      );
    });
    spawn('ios_webkit_debug_proxy', ['-c', `${udid}:9222`], 'iwdp');
    // Safari shows in the proxy only with a tab open; the test drives this one.
    const opened = await spawner.request('POST', `${WDA}/session`, { capabilities: {} });
    if (opened === null) throw new NotStarted(`WebDriverAgent opened no session at ${WDA}/session, so Safari has no tab`);
    const { sessionId } = JSON.parse(opened) as { sessionId: string };
    await spawner.request('POST', `${WDA}/session/${sessionId}/url`, { url: 'http://127.0.0.1:9/' });
    await spawner.request('DELETE', `${WDA}/session/${sessionId}`);
    await waitFor(`${IWDP}/json`, 'webSocketDebuggerUrl', IWDP_CEILING_S, 'ios_webkit_debug_proxy (a Safari tab)');
    return { PLAYWRIGHT_DEVICES_TARGET: 'iphone', IOS_UDID: udid, IOS_RUNNER_ID: runner };
  }

  async function startAndroid(): Promise<NodeJS.ProcessEnv> {
    const { stdout } = await spawner.run('adb', ['devices']);
    if (!stdout.split('\n').includes(`${options.id}\tdevice`)) {
      throw new NotStarted(`adb lists no device ${options.id} ready: plug it in and allow USB debugging`);
    }
    return { PLAYWRIGHT_DEVICES_TARGET: 'android', ANDROID_SERIAL: options.id };
  }

  async function runCommand(env: NodeJS.ProcessEnv): Promise<number> {
    const [command = '', ...args] = options.command;
    const child = spawner.spawn(command, args, { env: { ...options.env, ...env }, inherit: true });
    const interrupted = new Promise<'interrupted'>((resolve) => {
      options.signal.addEventListener(
        'abort',
        () => {
          resolve('interrupted');
        },
        { once: true },
      );
    });
    const outcome = await Promise.race([child.exited, interrupted]);
    if (outcome !== 'interrupted') return outcome;
    child.kill('SIGINT');
    return INTERRUPTED;
  }

  return {
    async run(): Promise<number> {
      try {
        return await runCommand(await (options.target === 'iphone' ? startIphone() : startAndroid()));
      } catch (error) {
        if (error instanceof Interrupted) return INTERRUPTED;
        if (!(error instanceof NotStarted)) throw error;
        spawner.print(`playwright-devices: ${error.message}`);
        return NOT_STARTED;
      } finally {
        for (const process of started.reverse()) process.kill('SIGTERM');
      }
    },
  };
}

/** Starts the phone side, runs the command, stops what it started; answers the command's exit code, 2 when the phone side could not start, 130 when interrupted. */
export function start(options: StartOptions, spawner: Spawner): Promise<number> {
  return session(options, spawner).run();
}
