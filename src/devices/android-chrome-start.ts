/**
 * Chrome's start on the Android phone for the journey's two routes (shyden-labs/playwright-devices#7, shyden-labs/playwright-devices#33).
 *
 * Measured 2026-11-20 on the OnePlus (research/devices/evidence/android-stale-command-line-2026-11-20.txt,
 * android-cdp-cold-start-readiness-2026-11-20.txt): Playwright writes Chrome's flags to a command-line
 * file and removes it only after a launch that worked, and a file left behind renames Chrome's DevTools
 * socket, so the CDP route finds no `chrome_devtools_remote`; Chrome reads that file only as the debug
 * app, so the Playwright route needs Chrome set as one; and once `/json/version` names the browser, a
 * connection is accepted at once (20 of 20 cold starts).
 */
import type { Adb } from './finger-scroll.ts';
import type { WdaClock } from './wda-client.ts';
import { realClock } from './clock.ts';

const CHROME = 'com.android.chrome';
const COMMAND_LINE = '/data/local/tmp/chrome-command-line';
/** The socket appeared 452-528 ms after `am start` in 20 cold starts; 30 s leaves room for a busy phone. */
const READY_CEILING_MS = 30_000;
const POLL_MS = 250;
/** One look at the endpoint may not hang the wait. */
const LOOK_CEILING_MS = 2_000;

export interface ChromeStartOptions {
  adb: Adb;
  fetchFn?: typeof fetch;
  clock?: WdaClock;
  /** The Mac's port forwarded to Chrome's DevTools socket. */
  port: number;
  ceilingMs?: number;
}

export interface StartedChrome {
  /** How long after the start the endpoint named the browser. */
  readyAfterMs: number;
  /** Removes the forward, stops Chrome and removes any command-line file. */
  stop: () => Promise<void>;
}

async function look(fetchFn: typeof fetch, url: string): Promise<{ ready: boolean; seen: string }> {
  try {
    const body = await (await fetchFn(url, { signal: AbortSignal.timeout(LOOK_CEILING_MS) })).text();
    return { ready: body.includes('"Browser"'), seen: body === '' ? 'an empty answer' : body.slice(0, 200) };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return { ready: false, seen: cause ?? (error as Error).message };
  }
}

/** Starts Chrome cold, without a leftover command-line file, and waits until its DevTools endpoint names the browser. */
export async function startChromeCold({
  adb,
  fetchFn = fetch,
  clock = realClock,
  port,
  ceilingMs = READY_CEILING_MS,
}: ChromeStartOptions): Promise<StartedChrome> {
  await adb(['shell', 'am', 'force-stop', CHROME]);
  await adb(['shell', 'rm', '-f', COMMAND_LINE]);
  // Chrome opens its DevTools socket only once it runs in the foreground.
  await adb(['shell', 'am', 'start', '-n', `${CHROME}/com.google.android.apps.chrome.Main`, '-d', 'http://127.0.0.1:9/']);
  await adb(['forward', `tcp:${port}`, 'localabstract:chrome_devtools_remote']);
  const stop = async () => {
    await adb(['forward', '--remove', `tcp:${port}`]);
    await stopChromeAfterPlaywright(adb);
  };
  const url = `http://127.0.0.1:${port}/json/version`;
  const started = clock.now();
  // Each look waits for the one before: a recursive wait, not a loop.
  const attempt = async (): Promise<StartedChrome> => {
    const { ready, seen } = await look(fetchFn, url);
    const waited = clock.now() - started;
    if (ready) return { readyAfterMs: waited, stop };
    if (waited >= ceilingMs) {
      throw new Error(`Chrome's DevTools endpoint ${url} did not name a browser within ${ceilingMs} ms; it last answered: ${seen}`);
    }
    await clock.sleep(POLL_MS);
    return attempt();
  };
  return attempt();
}

/** Stops Chrome and removes the command-line file Playwright leaves behind when a launch does not finish. */
export async function stopChromeAfterPlaywright(adb: Adb): Promise<void> {
  await adb(['shell', 'am', 'force-stop', CHROME]);
  await adb(['shell', 'rm', '-f', COMMAND_LINE]);
}

/** Refuses at once when Chrome is not the debug app: Playwright's Android launch would hang. */
export async function requireChromeDebugApp(adb: Adb): Promise<void> {
  const found = (await adb(['shell', 'settings', 'get', 'global', 'debug_app'])).trim();
  if (found === CHROME) return;
  throw new Error(
    `Chrome is not the debug app (debug_app is "${found}"), so Playwright's launch would wait for a socket Chrome never opens: run adb shell am set-debug-app --persistent ${CHROME}`,
  );
}
