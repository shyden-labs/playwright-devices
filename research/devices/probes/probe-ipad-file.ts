// Probe (shyden-labs/playwright-devices#7): how long each "is the file cell gone?" lookup takes right after the file is tapped
// in the iPad's Files picker, and the Mac's swap at that moment. Tells memory (every lookup slow)
// from the closing picker (only lookups during teardown slow) as the cause of the 30 s stalls.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { webkit } from '@playwright/test';
import { iosSession } from '../../../src/devices/device-session.ts';
import { connectWda } from '../../../src/devices/wda-client.ts';
import { startJourneyServer } from '../serve.ts';

const out = process.env.PROBE_OUT ?? '/tmp/probe.txt';
const wdaUrl = process.env.WDA_URL ?? 'http://127.0.0.1:8100';
const ROUNDS = Number(process.env.PROBE_ROUNDS ?? '5');
const folder = 'WebDriverAgentRunner-Runner';
const label = 'device-journey';
const predicate = `type == 'XCUIElementTypeCell' AND label BEGINSWITH '${label}, '`;
const lines: string[] = [];
const log = (s: string) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${s}`;
  console.log(line);
  lines.push(line);
};
const swap = () => /used = (\S+)/.exec(execFileSync('sysctl', ['vm.swapusage'], { encoding: 'utf8' }))?.[1] ?? '?';

// The client's session id, read from its own requests.
let sessionPath = '';
const recordingFetch: typeof fetch = (input, init) => {
  const match = /\/session\/[^/]+/.exec(input instanceof Request ? input.url : String(input));
  if (match) sessionPath = match[0];
  return fetch(input, init);
};

/** One raw lookup with a 120 s ceiling: answers how many cells matched and how long it took. */
async function timedLookup(): Promise<{ ms: number; count: number | string }> {
  const started = Date.now();
  try {
    const response = await fetch(new URL(`${sessionPath}/elements`, wdaUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ using: 'predicate string', value: predicate }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await response.json()) as { value: unknown };
    return { ms: Date.now() - started, count: Array.isArray(body.value) ? body.value.length : JSON.stringify(body.value).slice(0, 80) };
  } catch (error) {
    return { ms: Date.now() - started, count: `error: ${(error as Error).message}` };
  }
}

const server = await startJourneyServer(new URL('../journey.html', import.meta.url).pathname);
const browser = await webkit.connectOverCDP(process.env.IWDP_URL ?? 'http://127.0.0.1:9222');
const page = browser.contexts().flatMap((c) => c.pages())[0];
if (page === undefined) throw new Error('Safari has no tab open');
const wda = await connectWda({ url: wdaUrl, fetchFn: recordingFetch });
const session = iosSession({ page, wda, baseURL: server.baseURL, file: { folder, label } });
try {
  for (let round = 1; round <= ROUNDS; round += 1) {
    log(`=== round ${round}, swap ${swap()} ===`);
    await session.page.goto('/journey.html', { timeout: 120_000 });
    await session.page.getByLabel('File').tap();
    await wda.tapFirstShown(['Choose File']);
    const reached = await wda.tapFirstShown(['Browse', 'On My iPhone', 'On My iPad']);
    if (reached === 'Browse') await wda.tapFirstShown(['On My iPhone', 'On My iPad']);
    await wda.tapCellIcon(folder);
    // Baseline: a lookup while the picker is open and still.
    const before = await timedLookup();
    log(`picker open, still: lookup ${before.ms} ms, matched ${before.count}, swap ${swap()}`);
    await wda.tapCellIcon(label);
    log(`file tapped, swap ${swap()}`);
    for (let poll = 1; poll <= 40; poll += 1) {
      const { ms, count } = await timedLookup();
      log(`poll ${poll}: lookup ${ms} ms, matched ${count}, swap ${swap()}`);
      if (count === 0) break;
    }
    log(`page shows: ${(await page.getByTestId('file-result').textContent()) ?? '(none)'}`);
  }
  writeFileSync(`${out}.png`, await wda.screenshot());
} finally {
  writeFileSync(out, lines.join('\n') + '\n');
  await session.close().catch((e: unknown) => {
    log(`close: ${(e as Error).message}`);
  });
  await browser.close();
  await server.close();
}
