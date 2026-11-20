// Probe (shyden-labs/playwright-devices#33, shyden-labs/playwright-devices#7): which Playwright Android call hangs after an android-cdp run.
import { _android } from '@playwright/test';
const t0 = Date.now();
const at = (s: string) => {
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
};
const timeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        reject(new Error(`${what} hung ${ms} ms`));
      }, ms),
    ),
  ]);
at('devices()');
const devices = await timeout(_android.devices(), 60_000, 'devices()');
at(`devices: ${devices.map((d) => d.serial()).join(',')}`);
const device = devices.find((d) => d.serial() === '3b402284');
if (!device) throw new Error('no 3b402284');
at('launchBrowser()');
const context = await timeout(device.launchBrowser(), 90_000, 'launchBrowser()');
at('launched');
await context.close();
await device.close();
at('closed');
process.exit(0);
