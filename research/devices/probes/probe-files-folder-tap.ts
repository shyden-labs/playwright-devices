// Probe (shyden-labs/playwright-devices#38): on a CI simulator the Files picker's folder tap opens nothing.
// Logs the folder cell's rect, the window size and the cells listed, taps the icon exactly as
// tapCellIcon does, and keeps the screen 1 s and 3 s after the tap. Measurement only.
import { writeFileSync } from 'node:fs';
import { webkit } from '@playwright/test';
import { iosSession } from '../device-session.ts';
import { startJourneyServer } from '../serve.ts';
import { connectWda } from '../wda-client.ts';

const out = process.env.PROBE_OUT ?? 'research/devices/evidence/probe-files-folder-tap';
const wdaUrl = process.env.WDA_URL ?? 'http://127.0.0.1:8100';
const folder = 'WebDriverAgentRunner-Runner';
const lines: string[] = [];
const log = (s: string) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${s}`;
  console.log(line);
  lines.push(line);
};

let sessionPath = '';
const recordingFetch: typeof fetch = (input, init) => {
  const match = /\/session\/[^/]+/.exec(input instanceof Request ? input.url : input.toString());
  if (match) sessionPath = match[0];
  return fetch(input, init);
};
async function raw(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(new URL(`${sessionPath}${path}`, wdaUrl), {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return ((await response.json()) as { value: unknown }).value;
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const server = await startJourneyServer(new URL('../journey.html', import.meta.url).pathname);
const browser = await webkit.connectOverCDP(process.env.IWDP_URL ?? 'http://127.0.0.1:9222');
const page = browser.contexts().flatMap((c) => c.pages())[0];
if (page === undefined) throw new Error('Safari has no tab open');
const wda = await connectWda({ url: wdaUrl, fetchFn: recordingFetch });
const session = iosSession({ page, wda, baseURL: server.baseURL, file: { folder, label: 'device-journey' } });
try {
  await session.page.goto('/journey.html', { timeout: 120_000 });
  await session.page.getByLabel('File').tap();
  await wda.tapFirstShown(['Choose File']);
  const reached = await wda.tapFirstShown(['Browse', 'On My iPhone', 'On My iPad']);
  if (reached === 'Browse') await wda.tapFirstShown(['On My iPhone', 'On My iPad']);
  await wait(3000);
  log(`window ${JSON.stringify(await wda.windowSize())}`);
  const cells = (await raw('POST', '/elements', { using: 'class name', value: 'XCUIElementTypeCell' })) as Record<string, string>[];
  for (const cell of cells) {
    const id = Object.values(cell)[0] ?? '';
    log(
      `cell ${JSON.stringify(await raw('GET', `/element/${id}/attribute/label`))} rect ${JSON.stringify(await raw('GET', `/element/${id}/rect`))}`,
    );
  }
  writeFileSync(`${out}-before.png`, await wda.screenshot());
  await wda.tapCellIcon(folder);
  log('tapped the folder icon as tapCellIcon does');
  await wait(1000);
  writeFileSync(`${out}-after-1s.png`, await wda.screenshot());
  await wait(2000);
  writeFileSync(`${out}-after-3s.png`, await wda.screenshot());
  const after = (await raw('POST', '/elements', { using: 'class name', value: 'XCUIElementTypeCell' })) as Record<string, string>[];
  for (const cell of after) {
    const id = Object.values(cell)[0] ?? '';
    log(`after: cell ${JSON.stringify(await raw('GET', `/element/${id}/attribute/label`))}`);
  }
} finally {
  writeFileSync(`${out}.txt`, lines.join('\n') + '\n');
  await session.close().catch((e: unknown) => {
    log(`close: ${(e as Error).message}`);
  });
  await browser.close();
  await server.close();
}
