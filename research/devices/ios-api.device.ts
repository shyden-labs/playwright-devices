/**
 * Measures, for shyden-labs/playwright-devices#7, what Playwright itself offers to reach Safari on
 * iOS: whether WebKit accepts a CDP connection, and whether Playwright's `expect` accepts a
 * stand-in for a Locator (the adapter route). Prints each result; exits 0 once all are printed.
 */
import { expect, webkit, type Locator } from '@playwright/test';

async function measure(name: string, attempt: () => Promise<unknown>): Promise<void> {
  try {
    await attempt();
    console.log(`${name}: accepted`);
  } catch (error) {
    console.log(`${name}: refused: ${String(error).split('\n')[0] ?? ''}`);
  }
}

await measure('webkit.connectOverCDP', () => webkit.connectOverCDP('http://127.0.0.1:9221'));
const standIn = { textContent: () => Promise.resolve('Device journey') };
await measure('expect(stand-in).toHaveText', () => expect(standIn as unknown as Locator).toHaveText('Device journey'));
await measure('expect(stand-in).toBeVisible', () => expect(standIn as unknown as Locator).toBeVisible());
process.exit(0);
