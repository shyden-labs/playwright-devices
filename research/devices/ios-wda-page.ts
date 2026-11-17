/**
 * Wraps Playwright's `Page` for real iPhone Safari (shyden-labs/playwright-devices#7). Playwright
 * reads the page and runs every `expect`, but its input there is page JavaScript faking events
 * (evidence/ios-webkit-input-is-synthetic.txt). So taps, clicks and typing on the wrapped page go
 * to an `IosInput` (Apple's XCUITest through WebDriverAgent) as a real finger or real keys. An input
 * method not routed yet throws naming itself; it never falls back to Playwright's faked input.
 */
import type { Locator, Page } from '@playwright/test';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IosInput {
  /** A real finger tap at the centre of a box given in page (CSS) pixels of the visible viewport. */
  tapAt: (box: Box) => Promise<void>;
  /** Real key presses into whatever has focus. */
  type: (text: string) => Promise<void>;
}

const locatorMakers = new Set(['locator', 'getByRole', 'getByLabel', 'getByTestId', 'getByText', 'first', 'last', 'nth', 'filter']);
const unroutedOnLocator = new Set([
  'fill',
  'press',
  'pressSequentially',
  'hover',
  'dblclick',
  'check',
  'uncheck',
  'selectOption',
  'dragTo',
]);
const unroutedOnPage = new Set(['mouse', 'touchscreen', 'tap', 'click', 'fill', 'press', 'hover', 'dblclick']);

function notRouted(name: string): Error {
  return new Error(`not routed to WebDriverAgent yet: ${name}`);
}

/** A property of the real object, with a function bound to that object so its `this` is right. */
function realProperty(target: object, name: string | symbol): unknown {
  const value: unknown = Reflect.get(target, name, target);
  return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
}

async function viewport(page: Page): Promise<{ width: number; height: number }> {
  return page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
}

function wrapLocator(locator: Locator, page: Page, input: IosInput): Locator {
  const tap = async (): Promise<void> => {
    const box = await locator.boundingBox();
    if (box === null) throw new Error(`${String(locator)} has no box, so there is nowhere to tap`);
    const { width, height } = await viewport(page);
    const centreX = box.x + box.width / 2;
    const centreY = box.y + box.height / 2;
    if (centreX < 0 || centreY < 0 || centreX >= width || centreY >= height) {
      throw new Error(
        `${String(locator)} is outside the viewport (${JSON.stringify(box)} in ${String(width)}x${String(height)}), so a tap would miss it`,
      );
    }
    await input.tapAt(box);
  };
  return new Proxy(locator, {
    get(target, name) {
      if (name === 'tap' || name === 'click') return tap;
      if (typeof name === 'string' && unroutedOnLocator.has(name)) throw notRouted(name);
      if (typeof name === 'string' && locatorMakers.has(name)) {
        const make = Reflect.get(target, name, target) as (...args: unknown[]) => Locator;
        return (...args: unknown[]) => wrapLocator(make.apply(target, args), page, input);
      }
      return realProperty(target, name);
    },
  });
}

/** `baseURL` is where the phone reaches the test server; the WebKit-over-proxy route ignores Playwright's own. */
export function wrapPageForWda(page: Page, input: IosInput, baseURL: string): Page {
  const keyboard = new Proxy(page.keyboard, {
    get(target, name) {
      if (name === 'type') return (text: string) => input.type(text);
      if (typeof name === 'string') throw notRouted(`keyboard.${name}`);
      return realProperty(target, name);
    },
  });
  return new Proxy(page, {
    get(target, name) {
      if (name === 'goto') return (url: string, options?: Parameters<Page['goto']>[1]) => target.goto(new URL(url, baseURL).href, options);
      if (name === 'keyboard') return keyboard;
      if (typeof name === 'string' && unroutedOnPage.has(name)) throw notRouted(name);
      if (typeof name === 'string' && locatorMakers.has(name)) {
        const make = Reflect.get(target, name, target) as (...args: unknown[]) => Locator;
        return (...args: unknown[]) => wrapLocator(make.apply(target, args), target, input);
      }
      return realProperty(target, name);
    },
  });
}
