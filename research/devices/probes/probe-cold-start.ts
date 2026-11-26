// Probe (shyden-labs/playwright-devices#33 AC1): on repeated cold starts, when chrome_devtools_remote appears in /proc/net/unix,
// and whether connectOverCDP made at that moment is accepted. Measurement only: no retry.
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { trustedBin } from '../../../scripts/trusted-bin.ts';
const S = '3b402284';
const adb = (...a: string[]) => execFileSync(trustedBin('adb'), ['-s', S, ...a], { encoding: 'utf8', timeout: 30_000 });
const ROUNDS = Number(process.env.ROUNDS ?? '20');
let failures = 0;
// One round after another: a recursive run, not a loop.
const runRound = async (round: number): Promise<void> => {
  adb('shell', 'am', 'force-stop', 'com.android.chrome');
  adb('shell', 'rm', '-f', '/data/local/tmp/chrome-command-line');
  adb('forward', 'tcp:9230', 'localabstract:chrome_devtools_remote');
  const t0 = Date.now();
  adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main', '-d', 'http://127.0.0.1:9/');
  let seen = -1;
  while (Date.now() - t0 < 30_000) {
    if (adb('shell', 'cat', '/proc/net/unix').includes('@chrome_devtools_remote')) {
      seen = Date.now() - t0;
      break;
    }
  }
  let result: string;
  const c0 = Date.now();
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9230', { timeout: 30_000 });
    result = `connected in ${Date.now() - c0} ms, contexts ${browser.contexts().length}`;
    await browser.close();
  } catch (error) {
    failures += 1;
    const after = adb('shell', 'cat', '/proc/net/unix').includes('@chrome_devtools_remote');
    result = `FAILED after ${Date.now() - c0} ms: ${(error as Error).message.split('\n')[0] ?? ''}; socket now ${after ? 'present' : 'gone'}`;
  }
  console.log(`round ${round}: socket seen ${seen} ms after am start; ${result}`);
  adb('forward', '--remove', 'tcp:9230');
  if (round < ROUNDS) await runRound(round + 1);
};
await runRound(1);
adb('shell', 'am', 'force-stop', 'com.android.chrome');
console.log(`${ROUNDS - failures} of ${ROUNDS} connected at first try`);
