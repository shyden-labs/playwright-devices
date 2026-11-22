import type { Locator, Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { realInputPage, type RealInput } from '../../research/devices/real-input-page.ts';
import type { Box } from '../../research/devices/screen-map.ts';
import type { ScreenPoint } from '../../research/devices/wda-client.ts';

/** A Playwright locator stand-in with a fixed box; records the calls it answers itself. */
function fakeLocator(name: string, box: Box | null, calls: string[]): Locator {
  const locator: Record<string, unknown> = {
    toString: () => name,
    selector: name,
    boundingBox: () => Promise.resolve(box),
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
    first: () => fakeLocator(`${name}.first`, box, calls),
    locator: (selector: string) => fakeLocator(`${name} >> ${selector}`, box, calls),
    getByRole: (role: string) => fakeLocator(`${name} >> role=${role}`, box, calls),
  };
  return locator as unknown as Locator;
}

function fakePage(calls: string[], box: Box | null = { x: 10, y: 20, width: 30, height: 40 }): Page {
  const page: Record<string, unknown> = {
    goto: (url: string) => {
      calls.push(`goto ${url}`);
      return Promise.resolve(null);
    },
    title: () => Promise.resolve('Journey'),
    getByRole: (role: string) => fakeLocator(`role=${role}`, box, calls),
    getByLabel: (label: string) => fakeLocator(`label=${label}`, box, calls),
    getByTestId: (id: string) => fakeLocator(`testid=${id}`, box, calls),
    locator: (selector: string) => fakeLocator(selector, box, calls),
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
  };
}

/** Screen point = page box centre, shifted down by a 100-point toolbar. */
const toScreen = (box: Box) => Promise.resolve({ x: box.x + box.width / 2, y: 100 + box.y + box.height / 2 });

function build(box?: Box | null) {
  const calls: string[] = [];
  const page = realInputPage(fakePage(calls, box), { input: fakeInput(calls), toScreen, baseURL: 'http://127.0.0.1:4173/' });
  return { calls, page };
}

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
