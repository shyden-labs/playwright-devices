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

/** The simulator's Files picker was first listed 26 s after the tap (2026-11-19 evidence); about twice that. */
const NATIVE_CEILING_MS = 60_000;

/** A point on the screen, in WebDriverAgent's points. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** W3C's key for an element reference; WebDriverAgent also sends the older `ELEMENT`. */
const W3C_ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/** One finger's W3C pointer actions. */
function finger(actions: object[]) {
  return { actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions }] };
}

function at({ x, y }: ScreenPoint) {
  return { x: Math.round(x), y: Math.round(y) };
}

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

  /** The ids of the elements WebDriverAgent finds, none when nothing matches. */
  async function find(using: string, value: string): Promise<string[]> {
    const found = (await call('POST', `${base}/elements`, { using, value })) as Record<string, string>[];
    return found.map((element) => element[W3C_ELEMENT] ?? element.ELEMENT ?? '');
  }

  async function keyboardShown(): Promise<boolean> {
    return (await find('class name', 'XCUIElementTypeKeyboard')).length > 0;
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

    /** One real finger tap at a screen point. */
    async tapAt(point: ScreenPoint): Promise<void> {
      await call(
        'POST',
        `${base}/actions`,
        finger([
          { type: 'pointerMove', duration: 0, ...at(point) },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 50 },
          { type: 'pointerUp', button: 0 },
        ]),
      );
    },

    /** One real finger dragged from `from` to `to`. */
    async swipe(from: ScreenPoint, to: ScreenPoint): Promise<void> {
      await call(
        'POST',
        `${base}/actions`,
        finger([
          { type: 'pointerMove', duration: 0, ...at(from) },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerMove', duration: 300, ...at(to) },
          { type: 'pointerUp', button: 0 },
        ]),
      );
    },

    /**
     * Taps the first of `labels` the screen lists, waiting while a slow native
     * picker opens, and answers the label tapped. The iPhone and the iPad name
     * the same step differently (On My iPhone, On My iPad), so one call serves both.
     */
    async tapFirstShown(labels: string[]): Promise<string> {
      let hit: { label: string; id: string } | undefined;
      const anyShown = async (): Promise<boolean> => {
        for (const label of labels) {
          const [id] = await find('predicate string', `label == "${label}"`);
          if (id !== undefined) {
            hit = { label, id };
            return true;
          }
        }
        return false;
      };
      const named = labels.map((label) => `"${label}"`).join(', ');
      await waitFor(anyShown, NATIVE_CEILING_MS, `none of ${named} showed within ${NATIVE_CEILING_MS} ms; nothing was tapped`);
      const { label, id } = hit as { label: string; id: string };
      await call('POST', `${base}/element/${encodeURIComponent(id)}/click`, {});
      return label;
    },
  };
}
