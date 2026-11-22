// Probe (shyden-labs/playwright-devices#38): where the photo step's ~30 s goes on the CI simulators, and why
// the iPads' finger scroll after it goes unanswered. Times every WebDriverAgent call, keeps a screenshot and
// the screen's listing after Done and after the scroll, and makes the journey's own finger scroll.
import { writeFileSync } from 'node:fs';
import { webkit } from '@playwright/test';
import { connectWda } from '../wda-client.ts';
import { startJourneyServer } from '../serve.ts';
import { PHOTO_GRID_IMAGE } from '../ios-native.ts';
import { iosFingerScroll } from '../finger-scroll.ts';

const out = process.env.PROBE_OUT ?? 'research/devices/evidence/probe-photo-timing';
const wdaUrl = process.env.WDA_URL ?? 'http://127.0.0.1:8100';
const started = Date.now();
const lines: string[] = [];
const log = (s: string) => {
  const line = `${((Date.now() - started) / 1000).toFixed(2)}s ${s}`;
  console.log(line);
  lines.push(line);
};

/** Every WebDriverAgent call, its answer's status and how long it took. */
const timedFetch: typeof fetch = async (input, init) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname.replace(/\/session\/[^/]+/, '/session/:id');
  const method = init?.method ?? 'GET';
  const t0 = Date.now();
  try {
    const response = await fetch(input, init);
    log(`  wda ${method} ${path} -> ${response.status} in ${Date.now() - t0} ms`);
    return response;
  } catch (e) {
    log(`  wda ${method} ${path} -> ${(e as Error).message} after ${Date.now() - t0} ms`);
    throw e;
  }
};

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  log(`step ${name}`);
  const t0 = Date.now();
  try {
    await run();
    log(`step ${name} done in ${Date.now() - t0} ms`);
  } catch (e) {
    log(`step ${name} FAILED after ${Date.now() - t0} ms: ${(e as Error).message}`);
  }
}

const server = await startJourneyServer(new URL('../journey.html', import.meta.url).pathname);
const browser = await webkit.connectOverCDP(process.env.IWDP_URL ?? 'http://127.0.0.1:9222');
const page = browser.contexts().flatMap((c) => c.pages())[0];
if (page === undefined) throw new Error('Safari has no tab open');
const wda = await connectWda({ url: wdaUrl, fetchFn: timedFetch });

async function keepScreen(stage: string): Promise<void> {
  await step(`screenshot ${stage}`, async () => {
    writeFileSync(`${out}-${stage}.png`, await wda.screenshot());
  });
  await step(`source ${stage}`, async () => {
    const response = await timedFetch(new URL('/source', wdaUrl), { signal: AbortSignal.timeout(30_000) });
    const xml = ((await response.json()) as { value: string }).value;
    writeFileSync(`${out}-${stage}.xml`, xml);
    log(`  /source is ${xml.length} chars`);
  });
}

try {
  await step('open the page', () => page.goto(new URL('/journey.html', server.baseURL).href));
  await step('tap Photo', () => page.getByLabel('Photo').tap());
  await step('tap Photo Library', () => wda.tapFirstShown(['Photo Library']));
  await step('tap the first photo', () => wda.tapTopLeftOf(PHOTO_GRID_IMAGE));
  await step('tap Done', () => wda.tapFirstShown(['Done']));
  await keepScreen('after-done');
  await step('wait for the grid to go', () => wda.waitGone(PHOTO_GRID_IMAGE));
  log(`photo-result: ${(await page.getByTestId('photo-result').textContent()) ?? '(none)'}`);
  await step('finger scroll', () => iosFingerScroll(wda));
  log(`scroll-result: ${(await page.getByTestId('scroll-result').textContent()) ?? '(none)'}`);
  await keepScreen('after-scroll');
} finally {
  writeFileSync(`${out}.txt`, lines.join('\n') + '\n');
  await wda.close().catch((e: unknown) => {
    log(`close: ${(e as Error).message}`);
  });
  await browser.close();
  await server.close();
}
