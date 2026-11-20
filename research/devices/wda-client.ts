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

/**
 * Assumed, not yet measured: the page marker is drawn just before it is looked
 * for, so it should be listed at once; the iPad simulator run measures it.
 */
const ELEMENT_CEILING_MS = 5_000;

/** A point on the screen, in WebDriverAgent's points. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** The screen's size, in WebDriverAgent's points. */
export interface ScreenSize {
  width: number;
  height: number;
}

/** A rectangle on the screen, in WebDriverAgent's points. */
export interface ScreenRect extends ScreenPoint {
  width: number;
  height: number;
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

  /** The first of `labels` the screen lists now, with its element id. */
  async function firstShown(labels: string[]): Promise<{ label: string; id: string } | undefined> {
    for (const label of labels) {
      const [id] = await find('predicate string', `label == "${label}"`);
      if (id !== undefined) return { label, id };
    }
    return undefined;
  }

  async function tapAt(point: ScreenPoint): Promise<void> {
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
  }

  return {
    /** Deletes this client's WebDriverAgent session; call it in the test's `finally`. */
    async close(): Promise<void> {
      await call('DELETE', base);
    },

    /** Types `text` once the on-screen keyboard is listed: keys sent before it shows are lost. */
    async typeText(text: string): Promise<void> {
      await waitFor(
        keyboardShown,
        KEYBOARD_CEILING_MS,
        `the on-screen keyboard did not show within ${KEYBOARD_CEILING_MS} ms; no keys were sent`,
      );
      await call('POST', `${base}/wda/keys`, { value: graphemes(text) });
    },

    /** The screen rectangle, in points, of the element with this accessibility id, once it is listed. */
    async rectOf(accessibilityId: string): Promise<ScreenRect> {
      let id: string | undefined;
      const listed = async (): Promise<boolean> => {
        [id] = await find('accessibility id', accessibilityId);
        return id !== undefined;
      };
      await waitFor(
        listed,
        ELEMENT_CEILING_MS,
        `no element with accessibility id "${accessibilityId}" showed within ${ELEMENT_CEILING_MS} ms`,
      );
      return (await call('GET', `${base}/element/${encodeURIComponent(id as string)}/rect`)) as ScreenRect;
    },

    /** The screen's size, in points. */
    async windowSize(): Promise<ScreenSize> {
      return (await call('GET', `${base}/window/size`)) as ScreenSize;
    },

    /** One real finger tap at a screen point. */
    tapAt,

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
     * Taps the centre of the topmost, then leftmost, element a WebDriverAgent
     * predicate matches, waiting while a slow native picker opens: the photo
     * grid's first photo has no label of its own.
     */
    async tapTopLeftOf(predicate: string): Promise<void> {
      let ids: string[] = [];
      const listed = async (): Promise<boolean> => {
        ids = await find('predicate string', predicate);
        return ids.length > 0;
      };
      await waitFor(listed, NATIVE_CEILING_MS, `nothing matching ${predicate} showed within ${NATIVE_CEILING_MS} ms; nothing was tapped`);
      const rects: ScreenRect[] = [];
      for (const id of ids) rects.push((await call('GET', `${base}/element/${encodeURIComponent(id)}/rect`)) as ScreenRect);
      const [first] = rects.sort((a, b) => a.y - b.y || a.x - b.x) as [ScreenRect];
      await tapAt({ x: first.x + first.width / 2, y: first.y + first.height / 2 });
    },

    /**
     * Taps the first of `labels` the screen lists, waiting while a slow native
     * picker opens, and answers the label tapped. The iPhone and the iPad name
     * the same step differently (On My iPhone, On My iPad), so one call serves both.
     */
    async tapFirstShown(labels: string[]): Promise<string> {
      let hit: { label: string; id: string } | undefined;
      const anyShown = async (): Promise<boolean> => {
        hit = await firstShown(labels);
        return hit !== undefined;
      };
      const named = labels.map((label) => `"${label}"`).join(', ');
      await waitFor(anyShown, NATIVE_CEILING_MS, `none of ${named} showed within ${NATIVE_CEILING_MS} ms; nothing was tapped`);
      const { label, id } = hit as { label: string; id: string };
      await call('POST', `${base}/element/${encodeURIComponent(id)}/click`, {});
      return label;
    },

    /**
     * Taps the icon of the Files cell named `name`, waiting while the folder
     * lists. Files opens a cell on its icon, not its name (measured on the
     * iPhone Air, 2026-11-20: the cell "WebDriverAgentRunner-Runner, 1 item"
     * at y 200, height 176, its icon at y 204-288, its name below).
     */
    async tapCellIcon(name: string): Promise<void> {
      const predicate = `type == 'XCUIElementTypeCell' AND label BEGINSWITH '${name}, '`;
      let ids: string[] = [];
      const listed = async (): Promise<boolean> => {
        ids = await find('predicate string', predicate);
        return ids.length > 0;
      };
      await waitFor(listed, NATIVE_CEILING_MS, `no cell named "${name}" showed within ${NATIVE_CEILING_MS} ms; nothing was tapped`);
      const cell = (await call('GET', `${base}/element/${encodeURIComponent(ids[0] ?? '')}/rect`)) as ScreenRect;
      await tapAt({ x: cell.x + cell.width / 2, y: cell.y + cell.height / 4 });
    },

    /** Looks once, without waiting, and taps the first of `labels` listed; answers it, or undefined when none showed. */
    async tapIfShown(labels: string[]): Promise<string | undefined> {
      const hit = await firstShown(labels);
      if (hit === undefined) return undefined;
      await call('POST', `${base}/element/${encodeURIComponent(hit.id)}/click`, {});
      return hit.label;
    },
  };
}
