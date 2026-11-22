import type { Locator, Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPlace, realInputPage, type Place, type RealInput } from '../../research/devices/real-input-page.ts';
import type { Box } from '../../research/devices/screen-map.ts';
import type { ScreenPoint, WdaClock } from '../../research/devices/wda-client.ts';

/** Answers each of `values` in turn, then the last one for good. */
function inTurn<T>(values: T[]): () => T {
  let next = 0;
  return () => values[Math.min(next++, values.length - 1)] as T;
}

/** A clock that moves only when slept. */
function fakeClock(): WdaClock {
  let now = 0;
  return {
    now: () => now,
    sleep: (ms: number) => {
      now += ms;
      return Promise.resolve();
    },
  };
}

/** What shows of a 400 by 800 page with nothing covering it. */
const WHOLE_VIEW = { left: 0, top: 0, width: 400, height: 800 };

/** A Playwright locator stand-in with a fixed box; records the calls it answers itself. */
function fakeLocator(name: string, box: Box | null | (() => Box | null), calls: string[], view = WHOLE_VIEW): Locator {
  const boxNow = typeof box === 'function' ? box : () => box;
  let last: Box | null = null;
  const locator: Record<string, unknown> = {
    toString: () => name,
    selector: name,
    boundingBox: () => Promise.resolve((last = boxNow())),
    // The place is read in the page; here it is the box last read, seen against `view`.
    evaluate: () => Promise.resolve({ centreY: (last?.y ?? 0) + (last?.height ?? 0) / 2, view } satisfies Place),
    textContent: () => Promise.resolve(`text of ${name}`),
    click: () => {
      calls.push(`playwright click ${name}`);
      return Promise.resolve();
    },
    tap: () => {
      calls.push(`playwright tap ${name}`);
      return Promise.resolve();
    },
    fill: () => Promise.resolve(),
    first: () => fakeLocator(`${name}.first`, box, calls, view),
    locator: (selector: string) => fakeLocator(`${name} >> ${selector}`, box, calls, view),
    getByRole: (role: string) => fakeLocator(`${name} >> role=${role}`, box, calls, view),
  };
  return locator as unknown as Locator;
}

function fakePage(
  calls: string[],
  box: Box | null | (() => Box | null) = { x: 10, y: 20, width: 30, height: 40 },
  view = WHOLE_VIEW,
): Page {
  const page: Record<string, unknown> = {
    goto: (url: string) => {
      calls.push(`goto ${url}`);
      return Promise.resolve(null);
    },
    title: () => Promise.resolve('Journey'),
    getByRole: (role: string) => fakeLocator(`role=${role}`, box, calls, view),
    getByLabel: (label: string) => fakeLocator(`label=${label}`, box, calls, view),
    getByTestId: (id: string) => fakeLocator(`testid=${id}`, box, calls, view),
    locator: (selector: string) => fakeLocator(selector, box, calls, view),
    keyboard: { type: () => Promise.resolve(), press: () => Promise.resolve() },
    mouse: { click: () => Promise.resolve() },
    touchscreen: { tap: () => Promise.resolve() },
  };
  return page as unknown as Page;
}

function fakeInput(calls: string[]): RealInput {
  return {
    tapAt: (point: ScreenPoint) => {
      calls.push(`wda tap ${point.x},${point.y}`);
      return Promise.resolve();
    },
    typeText: (text: string) => {
      calls.push(`wda type ${text}`);
      return Promise.resolve();
    },
    swipe: (from: ScreenPoint, to: ScreenPoint) => {
      calls.push(`finger drag ${from.x},${from.y} to ${to.x},${to.y}`);
      return Promise.resolve();
    },
  };
}

/** Screen point = page box centre, shifted down by a 100-point toolbar. */
const toScreen = (box: Box) => Promise.resolve({ x: box.x + box.width / 2, y: 100 + box.y + box.height / 2 });

function build(box?: Box | null | (() => Box | null), view = WHOLE_VIEW) {
  const calls: string[] = [];
  const clock = fakeClock();
  const page = realInputPage(fakePage(calls, box, view), {
    input: fakeInput(calls),
    toScreen,
    baseURL: 'http://127.0.0.1:4173/',
    clock,
  });
  return { calls, page, clock };
}

/** Colour on the pixel_tablet emulator with the keyboard up (run 44974365844): 351 to 394, below what shows. */
const UNDER_KEYBOARD = { x: 16, y: 351, width: 873, height: 43 };
const TABLET_VIEW = { left: 0, top: 0, width: 1280, height: 312 };
const SHOWING = { x: 16, y: 151, width: 873, height: 43 };

describe('realInputPage', () => {
  it('opens a relative URL against the base URL, which this route ignores otherwise', async () => {
    const { calls, page } = build();

    await page.goto('/journey.html');

    expect(calls).toEqual(['goto http://127.0.0.1:4173/journey.html']);
  });

  it('leaves an absolute URL as given', async () => {
    const { calls, page } = build();

    await page.goto('https://example.test/a');

    expect(calls).toEqual(['goto https://example.test/a']);
  });

  it('taps a locator with one real finger at its centre on the screen, never Playwright’s own tap', async () => {
    const { calls, page } = build();

    await page.getByRole('button').tap();
    await page.getByLabel('Name').click();

    expect(calls).toEqual(['wda tap 25,140', 'wda tap 25,140']);
  });

  it('keeps a locator chained from a locator on the real finger', async () => {
    const { calls, page } = build();

    await page.locator('form').getByRole('button').first().tap();

    expect(calls).toEqual(['wda tap 25,140']);
  });

  it('types through WebDriverAgent', async () => {
    const { calls, page } = build();

    await page.keyboard.type('hello');

    expect(calls).toEqual(['wda type hello']);
  });

  it('passes every read through to the real page and locator', async () => {
    const { page } = build();

    expect(await page.title()).toBe('Journey');
    expect(await page.getByTestId('t').textContent()).toBe('text of testid=t');
  });

  it("passes a locator's plain properties through unchanged", () => {
    const { page } = build();

    expect((page.getByTestId('t') as unknown as { selector: string }).selector).toBe('testid=t');
  });

  it('refuses a tap on a locator with no box, naming it', async () => {
    const { calls, page } = build(null);

    await expect(page.getByRole('button').tap()).rejects.toThrow('cannot tap role=button: it has no box on the page (hidden or detached)');
    expect(calls).toEqual([]);
  });

  it('drags the page up by finger until a field under the keyboard shows, waits for it to stop, then taps it', async () => {
    const { calls, page } = build(inTurn([UNDER_KEYBOARD, UNDER_KEYBOARD, { ...SHOWING, y: 171 }, SHOWING, SHOWING]), TABLET_VIEW);

    await page.getByLabel('Colour').tap();

    // From 75% to 25% of what shows, at its middle; the toolbar stand-in adds 100 to y.
    expect(calls).toEqual(['finger drag 640,334 to 640,178', 'wda tap 452.5,272.5']);
  });

  it('drags the page down by finger when the target is above what shows', async () => {
    const view = { left: 0, top: 400, width: 400, height: 300 };
    const { calls, page } = build(
      inTurn([
        { x: 0, y: 100, width: 40, height: 20 },
        { x: 0, y: 100, width: 40, height: 20 },
        { x: 0, y: 500, width: 40, height: 20 },
      ]),
      view,
    );

    await page.getByRole('button').tap();

    expect(calls).toEqual(['finger drag 200,575 to 200,725', 'wda tap 20,610']);
  });

  it('taps a target whose centre sits on the edge of what shows without dragging', async () => {
    const { calls, page } = build({ x: 0, y: 292, width: 40, height: 40 }, TABLET_VIEW);

    await page.getByRole('button').tap();

    expect(calls).toEqual(['wda tap 20,412']);
  });

  it('refuses, naming the target and where it stayed, when five finger drags never bring it into view, and taps nothing', async () => {
    const { calls, page } = build(UNDER_KEYBOARD, TABLET_VIEW);

    await expect(page.getByLabel('Colour').tap()).rejects.toThrow(
      'cannot tap label=Colour: its centre stayed at page y 372.5, outside what shows (0 to 312), after 5 finger drags',
    );
    expect(calls.filter((c) => c.startsWith('finger drag'))).toHaveLength(5);
    expect(calls.filter((c) => c.startsWith('wda tap'))).toEqual([]);
  });

  it('refuses, naming the last two reads, when the target never stops moving within 5 s', async () => {
    let y = 0;
    const { calls, page } = build(() => ({ x: 0, y: (y += 10), width: 40, height: 20 }));

    await expect(page.getByRole('button').tap()).rejects.toThrow(
      /^cannot tap role=button: it did not stop moving within 5000 ms; last two boxes: \{"x":0,"y":\d+0,"width":40,"height":20\} then \{"x":0,"y":\d+0,"width":40,"height":20\}$/,
    );
    expect(calls).toEqual([]);
  });

  it('refuses a target that loses its box while the page settles, naming it', async () => {
    const { calls, page } = build(inTurn<Box | null>([UNDER_KEYBOARD, UNDER_KEYBOARD, null]), TABLET_VIEW);

    await expect(page.getByLabel('Colour').tap()).rejects.toThrow(
      'cannot tap label=Colour: it has no box on the page (hidden or detached)',
    );
    expect(calls).toEqual(['finger drag 640,334 to 640,178']);
  });

  it.each([
    ['locator fill', (page: Page) => page.getByLabel('Name').fill('x'), 'fill'],
    ['keyboard press', (page: Page) => page.keyboard.press('Enter'), 'keyboard.press'],
    ['mouse', (page: Page) => page.mouse.click(1, 2), 'mouse.click'],
    ['touchscreen', (page: Page) => page.touchscreen.tap(1, 2), 'touchscreen.tap'],
  ])('refuses %s, which is not routed to real input yet, rather than fake it', (_name, act, method) => {
    const { page } = build();

    expect(() => act(page)).toThrow(`not routed to real input yet: ${method}`);
  });
});

describe('readPlace', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the element's centre and the visual viewport in the same page coordinates", () => {
    vi.stubGlobal('window', {
      visualViewport: { offsetLeft: 4, offsetTop: 92, width: 382, height: 310.5 },
      innerWidth: 390,
      innerHeight: 580,
    });
    const element = { getBoundingClientRect: () => ({ top: 257, height: 42 }) } as unknown as Element;

    expect(readPlace(element)).toEqual({ centreY: 278, view: { left: 4, top: 92, width: 382, height: 310.5 } });
  });

  it('falls back to the whole window where there is no visual viewport', () => {
    vi.stubGlobal('window', { visualViewport: null, innerWidth: 390, innerHeight: 580 });
    const element = { getBoundingClientRect: () => ({ top: 10, height: 20 }) } as unknown as Element;

    expect(readPlace(element)).toEqual({ centreY: 20, view: { left: 0, top: 0, width: 390, height: 580 } });
  });
});
