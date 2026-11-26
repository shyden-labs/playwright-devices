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
import type { ScreenPoint } from './wda-client.ts';

/** The real input this stand-in sends. */
export interface RealInput {
  tapAt(point: ScreenPoint): Promise<void>;
  typeText(text: string): Promise<void>;
}

export interface RealInputPageOptions {
  input: RealInput;
  /** The screen point at the centre of a page box. */
  toScreen: (box: Box) => Promise<ScreenPoint>;
  /** Resolves relative URLs: Playwright gives the iOS route no context of its own to hold it. */
  baseURL: string;
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

export function realInputPage(page: Page, { input, toScreen, baseURL }: RealInputPageOptions): Page {
  const nameOf = (locator: Locator): string => String((locator as unknown as { name?: string }).name ?? locator);

  async function tap(locator: Locator): Promise<void> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error(`cannot tap ${nameOf(locator)}: it has no box on the page (hidden or detached)`);
    await input.tapAt(await toScreen(box));
  }

  function wrapLocator(locator: Locator): Locator {
    return new Proxy(locator, {
      get(target, prop, receiver) {
        if (prop === 'tap' || prop === 'click') return () => tap(target);
        if (typeof prop === 'string' && UNROUTED_LOCATOR_INPUT.has(prop)) return refuse(prop);
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof prop === 'string' && LOCATOR_MAKERS.has(prop) && typeof value === 'function') {
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
      if (typeof prop === 'string' && LOCATOR_MAKERS.has(prop) && typeof value === 'function') {
        return (...args: unknown[]) => wrapLocator((value as (...a: unknown[]) => Locator).apply(target, args));
      }
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
