/**
 * The real outside effects behind `connectPhone` (shyden-labs/playwright-devices#54):
 * Playwright's CDP and Android connections, WebDriverAgent, adb and devicectl.
 */
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { _android, chromium, webkit } from '@playwright/test';
import { requireChromeDebugApp, startChromeCold, stopChromeAfterPlaywright } from './android-chrome-start.ts';
import type { Adb } from './finger-scroll.ts';
import type { ConnectEffects } from './phone-connect.ts';
import { connectWda } from './wda-client.ts';

/** No adb or devicectl call the fixture makes takes long; a hung one (uiautomator on an emulator, 2026-11-18) fails naming itself. */
const CALL_CEILING_MS = 30_000;

/** Runs `file args`, answering stdout; a failure is `describe`d with stderr, or the error when stderr is empty. */
function run(file: string, args: string[], describe: (stopped: boolean) => string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: CALL_CEILING_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${describe(error.killed === true)}: ${stderr || error.message}`));
      else resolve(stdout);
    });
  });
}

function adbFor(serial: string): Adb {
  return (args) =>
    run('adb', ['-s', serial, ...args], (stopped) => `adb ${args.join(' ')} failed${stopped ? ` after ${CALL_CEILING_MS} ms` : ''}`);
}

async function copyToIphone(udid: string, runnerId: string, file: string): Promise<void> {
  const args = ['devicectl', 'device', 'copy', 'to', '--device', udid, '--domain-type', 'appDataContainer'];
  args.push('--domain-identifier', runnerId, '--source', file, '--destination', `Documents/${basename(file)}`);
  await run('xcrun', args, () => `could not put ${file} on the iPhone ${udid}`);
}

export const REAL_EFFECTS: ConnectEffects = {
  webkitOverCDP: (url) => webkit.connectOverCDP(url),
  chromiumOverCDP: (url) => chromium.connectOverCDP(url),
  androidDevices: () => _android.devices(),
  connectWda: (url) => connectWda({ url }),
  adbFor,
  copyToIphone,
  startChrome: (adb, port) => startChromeCold({ adb, port }),
  requireChromeDebugApp: (adb) => requireChromeDebugApp(adb),
  stopChromeAfterPlaywright: (adb) => stopChromeAfterPlaywright(adb),
};
