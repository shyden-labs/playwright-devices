/**
 * A stand-in for Playwright's `Page` on a phone (shyden-labs/playwright-devices#7).
 *
 * Playwright can navigate, read and assert on Safari and Chrome on a phone,
 * but its input there is not the phone's: page JavaScript faking events on iOS,
 * DevTools-injected events on Android. So every read goes to the real page,
 * and every tap and key goes to the phone's own input (WebDriverAgent on iOS,
 * `adb shell input` on Android). Input not routed yet throws naming the
 * method: it never falls back to Playwright's synthetic events.
 */
import type { Locator, Page } from '@playwright/test';
import type { Box } from './screen-map.ts';
import { realClock, type ScreenPoint, type WdaClock } from './wda-client.ts';

/** The real input this stand-in sends. */
export interface RealInput {
  tapAt(point: ScreenPoint): Promise<void>;
  typeText(text: string): Promise<void>;
  /** One real finger dragged across the screen. */
  swipe(from: ScreenPoint, to: ScreenPoint): Promise<void>;
}

/** Where an element's centre is, and what of the page shows, in the same page (client) coordinates. */
export interface Place {
  centreY: number;
  view: { left: number; top: number; width: number; height: number };
}

/** Reads `element`'s place inside the page (passed to `locator.evaluate`). */
export function readPlace(element: Element): Place {
  const rect = element.getBoundingClientRect();
  const visual = window.visualViewport;
  return {
    centreY: rect.top + rect.height / 2,
    view:
      visual === null
        ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
        : { left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height },
  };
}

/**
 * Finger drags allowed to bring a target into view. A field under the keyboard
 * on the pixel_tablet emulator sat 60 CSS px below what showed (run 44974365844).
 */
const MAX_DRAGS = 5;

/** How long a target may keep moving after a drag or a keyboard change. */
const SETTLE_CEILING_MS = 5_000;

/** Pause between reads while the target settles. */
const SETTLE_POLL_MS = 100;

/** A drag runs between these fractions of what shows, at its middle. */
const DRAG_NEAR = 0.25;
const DRAG_FAR = 0.75;

export interface RealInputPageOptions {
  input: RealInput;
  /** The screen point at the centre of a page box. */
  toScreen: (box: Box) => Promise<ScreenPoint>;
  /** Resolves relative URLs: Playwright gives the iOS route no context of its own to hold it. */
  baseURL: string;
  clock?: WdaClock;
}

/** Locator methods that make a locator, so the result stays on real input. */
const LOCATOR_MAKERS = new Set([
  'locator',
  'getByRole',
  'getByLabel',
  'getByTestId',
  'getByText',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'first',
  'last',
  'nth',
  'filter',
  'and',
  'or',
]);

/** Locator input that would be faked by Playwright on this route. */
const UNROUTED_LOCATOR_INPUT = new Set([
  'fill',
  'clear',
  'press',
  'pressSequentially',
  'type',
  'check',
  'uncheck',
  'setChecked',
  'hover',
  'dblclick',
  'dragTo',
  'selectOption',
  'selectText',
  'setInputFiles',
  'dispatchEvent',
]);

function refuse(method: string): () => never {
  return () => {
    throw new Error(`not routed to real input yet: ${method}`);
  };
}

/** An object whose every method is refused, naming `prefix.method`. */
function refuseAll(prefix: string): object {
  return new Proxy({}, { get: (_target, prop) => refuse(`${prefix}.${String(prop)}`) });
}

export function realInputPage(page: Page, { input, toScreen, baseURL, clock = realClock }: RealInputPageOptions): Page {
  /**
   * The target's box once two reads in a row agree, both the box and where what shows sits: a keyboard or a
   * finger drag moves the page, and a drag can pan what shows on, as a fling, while the box stays put
   * (pixel_tablet emulator, run 45027508984: aimed mid-fling, the finger landed on Chrome's bar above the keyboard).
   */
  async function settledBox(locator: Locator): Promise<Box> {
    const read = async (): Promise<Box & { viewTop: number; viewLeft: number }> => {
      const box = await locator.boundingBox();
      if (box === null) throw new Error(`cannot tap ${locator.toString()}: it has no box on the page (hidden or detached)`);
      const { view } = await locator.evaluate(readPlace);
      return { ...box, viewTop: view.top, viewLeft: view.left };
    };
    const deadline = clock.now() + SETTLE_CEILING_MS;
    let previous = await read();
    for (;;) {
      // Reads a poll apart: two back to back agree even mid-fling.
      await clock.sleep(SETTLE_POLL_MS);
      const current = await read();
      if (JSON.stringify(current) === JSON.stringify(previous)) {
        const { x, y, width, height } = current;
        return { x, y, width, height };
      }
      if (clock.now() >= deadline) {
        throw new Error(
          `cannot tap ${locator.toString()}: it did not stop moving within ${SETTLE_CEILING_MS} ms; last two boxes: ${JSON.stringify(previous)} then ${JSON.stringify(current)}`,
        );
      }
      previous = current;
    }
  }

  /** A point of the page, as a box with no size, on the screen. */
  const screenAt = (x: number, y: number) => toScreen({ x, y, width: 0, height: 0 });

  /**
   * Taps the target with one real finger, first dragging the page by finger, as a person would, until the
   * target's centre shows: one under the keyboard cannot be touched where it is.
   */
  async function tap(locator: Locator): Promise<void> {
    let box = await settledBox(locator);
    for (let drags = 0; ; drags++) {
      const { centreY, view } = await locator.evaluate(readPlace);
      const bottom = view.top + view.height;
      if (centreY >= view.top && centreY <= bottom) break;
      if (drags === MAX_DRAGS) {
        throw new Error(
          `cannot tap ${locator.toString()}: its centre stayed at page y ${centreY}, outside what shows (${view.top} to ${bottom}), after ${MAX_DRAGS} finger drags`,
        );
      }
      const x = view.left + view.width / 2;
      const near = view.top + view.height * DRAG_NEAR;
      const far = view.top + view.height * DRAG_FAR;
      // Below what shows: the finger pushes the page up; above: down.
      const [fromY, toY] = centreY > bottom ? [far, near] : [near, far];
      await input.swipe(await screenAt(x, fromY), await screenAt(x, toY));
      box = await settledBox(locator);
    }
    await input.tapAt(await toScreen(box));
  }

  function wrapLocator(locator: Locator): Locator {
    return new Proxy(locator, {
      get(target, prop, receiver) {
        if (prop === 'tap' || prop === 'click') return () => tap(target);
        if (typeof prop === 'string' && UNROUTED_LOCATOR_INPUT.has(prop)) return refuse(prop);
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof prop === 'string' && LOCATOR_MAKERS.has(prop)) {
          return (...args: unknown[]) => wrapLocator((value as (...a: unknown[]) => Locator).apply(target, args));
        }
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  const keyboard = new Proxy(
    {},
    {
      get: (_target, prop) => (prop === 'type' ? (text: string) => input.typeText(text) : refuse(`keyboard.${String(prop)}`)),
    },
  );

  return new Proxy(page, {
    get(target, prop, receiver) {
      if (prop === 'goto') return (url: string, options?: object) => target.goto(new URL(url, baseURL).href, options);
      if (prop === 'keyboard') return keyboard;
      if (prop === 'mouse' || prop === 'touchscreen') return refuseAll(prop);
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof prop === 'string' && LOCATOR_MAKERS.has(prop)) {
        return (...args: unknown[]) => wrapLocator((value as (...a: unknown[]) => Locator).apply(target, args));
      }
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
