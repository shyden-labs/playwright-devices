/**
 * A small WebDriverAgent client: real touches and keys on an iPhone, an iPad
 * or the iOS Simulator (shyden-labs/playwright-devices#7).
 */

/** Time, passed in so tests can move it. */
export interface WdaClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface WdaOptions {
  /** WebDriverAgent's base URL, e.g. `http://127.0.0.1:8100`. */
  url: string;
  fetchFn?: typeof fetch;
  clock?: WdaClock;
}

const realClock: WdaClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** How often a wait asks WebDriverAgent again. */
const POLL_MS = 100;

/**
 * The keyboard showed 0.3-1.3 s after the tap on the iPad simulator; a slow
 * simulator took ~14 s to show a chosen file's name (2026-11-19 evidence).
 */
const KEYBOARD_CEILING_MS = 15_000;

/** The characters a person would type, one per key, accents and emoji kept whole. */
function graphemes(text: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
}

export async function connectWda({ url, fetchFn = fetch, clock = realClock }: WdaOptions) {
  async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const response = await fetchFn(new URL(path, url), {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed = (await response.json()) as { value: unknown };
    if (!response.ok) {
      const message =
        (parsed.value as { message?: string; error?: string } | null)?.message ?? (parsed.value as { error?: string } | null)?.error;
      throw new Error(`WebDriverAgent refused ${method} ${path} (${response.status}): ${message ?? 'no message'}`);
    }
    return parsed.value;
  }

  /** Asks `ready` until it answers true, failing at `ceilingMs` with `failure`. */
  async function waitFor(ready: () => Promise<boolean>, ceilingMs: number, failure: string): Promise<void> {
    const deadline = clock.now() + ceilingMs;
    while (!(await ready())) {
      if (clock.now() >= deadline) throw new Error(failure);
      await clock.sleep(POLL_MS);
    }
  }

  const created = (await call('POST', '/session', { capabilities: {} })) as { sessionId: string };
  const base = `/session/${created.sessionId}`;

  async function keyboardShown(): Promise<boolean> {
    const found = await call('POST', `${base}/elements`, { using: 'class name', value: 'XCUIElementTypeKeyboard' });
    return Array.isArray(found) && found.length > 0;
  }

  return {
    /** Types `text` once the on-screen keyboard is listed: keys sent before it shows are lost. */
    async typeText(text: string): Promise<void> {
      await waitFor(
        keyboardShown,
        KEYBOARD_CEILING_MS,
        `the on-screen keyboard did not show within ${KEYBOARD_CEILING_MS} ms; no keys were sent`,
      );
      await call('POST', `${base}/wda/keys`, { value: graphemes(text) });
    },
  };
}
