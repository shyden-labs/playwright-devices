import { describe, it, expect, vi } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { wrapPageForWda, type Box, type IosInput } from '../../research/devices/ios-wda-page.ts';

const box: Box = { x: 10, y: 20, width: 30, height: 40 };

function fakeLocator(boxValue: Box | null = box): Record<string, unknown> {
  const locator: Record<string, unknown> = {
    boundingBox: vi.fn(() => Promise.resolve(boxValue)),
    tap: vi.fn(() => Promise.resolve()),
    click: vi.fn(() => Promise.resolve()),
    textContent: vi.fn(function (this: unknown) {
      return Promise.resolve(this === locator ? 'bound' : 'unbound');
    }),
    toString: () => 'getByRole(button)',
  };
  for (const name of ['locator', 'getByLabel', 'getByTestId', 'first', 'nth']) locator[name] = vi.fn(() => locator);
  return locator;
}

function fakePage(locator = fakeLocator(), viewport: { width: number; height: number } | null = { width: 400, height: 800 }) {
  const page = {
    goto: vi.fn(() => Promise.resolve(null)),
    url: vi.fn(function (this: unknown) {
      return this === page ? 'bound' : 'unbound';
    }),
    viewportSize: vi.fn(() => viewport),
    evaluate: vi.fn(() => Promise.resolve({ width: 400, height: 800 })),
    keyboard: { type: vi.fn(() => Promise.resolve()) },
    mouse: {},
    touchscreen: {},
    getByRole: vi.fn(() => locator),
    getByLabel: vi.fn(() => locator),
    getByTestId: vi.fn(() => locator),
    locator: vi.fn(() => locator),
  };
  return page;
}

function fakeInput(): IosInput & { tapAt: ReturnType<typeof vi.fn>; type: ReturnType<typeof vi.fn> } {
  return { tapAt: vi.fn(() => Promise.resolve()), type: vi.fn(() => Promise.resolve()) };
}

function wrap(page: ReturnType<typeof fakePage>, input = fakeInput()): Page {
  return wrapPageForWda(page as unknown as Page, input, 'http://10.0.0.2:4517');
}

describe('wrapPageForWda', () => {
  it('resolves a relative goto against the base URL', async () => {
    const page = fakePage();
    await wrap(page).goto('/journey.html');
    expect(page.goto).toHaveBeenCalledWith('http://10.0.0.2:4517/journey.html', undefined);
  });

  it('passes an absolute goto through unchanged', async () => {
    const page = fakePage();
    await wrap(page).goto('https://a.test/x', { timeout: 5 });
    expect(page.goto).toHaveBeenCalledWith('https://a.test/x', { timeout: 5 });
  });

  it('sends a locator tap to WebDriverAgent at the locator box, never Playwright', async () => {
    const locator = fakeLocator();
    const input = fakeInput();
    await wrap(fakePage(locator), input).getByRole('button', { name: 'Tap me' }).tap();
    expect(input.tapAt).toHaveBeenCalledWith(box);
    expect(locator.tap).not.toHaveBeenCalled();
  });

  it('sends a locator click to WebDriverAgent, never Playwright', async () => {
    const locator = fakeLocator();
    const input = fakeInput();
    await wrap(fakePage(locator), input).getByRole('button').click();
    expect(input.tapAt).toHaveBeenCalledWith(box);
    expect(locator.click).not.toHaveBeenCalled();
  });

  it('refuses to tap a locator with no box', async () => {
    const input = fakeInput();
    await expect(
      wrap(fakePage(fakeLocator(null)), input)
        .getByRole('button')
        .tap(),
    ).rejects.toThrow(/has no box/);
    expect(input.tapAt).not.toHaveBeenCalled();
  });

  it('refuses to tap a locator below the visible viewport', async () => {
    const input = fakeInput();
    const below = fakeLocator({ x: 10, y: 900, width: 30, height: 40 });
    await expect(wrap(fakePage(below), input).getByRole('button').tap()).rejects.toThrow(/outside the viewport/);
    expect(input.tapAt).not.toHaveBeenCalled();
  });

  it('reads the viewport from the page when Playwright has none', async () => {
    const page = fakePage(fakeLocator({ x: 10, y: 900, width: 30, height: 40 }), null);
    await expect(wrap(page).getByRole('button').tap()).rejects.toThrow(/outside the viewport/);
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('keeps a chained locator tap on WebDriverAgent', async () => {
    const locator = fakeLocator();
    const input = fakeInput();
    await wrap(fakePage(locator), input).locator('form').getByLabel('Name').tap();
    await wrap(fakePage(locator), input).getByTestId('x').first().tap();
    expect(input.tapAt).toHaveBeenCalledTimes(2);
    expect(locator.tap).not.toHaveBeenCalled();
  });

  it('sends keyboard typing to WebDriverAgent', async () => {
    const page = fakePage();
    const input = fakeInput();
    await wrap(page, input).keyboard.type('Ayu');
    expect(input.type).toHaveBeenCalledWith('Ayu');
    expect(page.keyboard.type).not.toHaveBeenCalled();
  });

  for (const name of ['fill', 'press', 'hover', 'dblclick']) {
    it(`refuses the unrouted locator method ${name}`, () => {
      const locator = wrap(fakePage()).getByRole('button') as unknown as Record<string, unknown>;
      expect(() => locator[name]).toThrow(`not routed to WebDriverAgent yet: ${name}`);
    });
  }

  for (const name of ['mouse', 'touchscreen']) {
    it(`refuses the unrouted page input ${name}`, () => {
      const page = wrap(fakePage()) as unknown as Record<string, unknown>;
      expect(() => page[name]).toThrow(`not routed to WebDriverAgent yet: ${name}`);
    });
  }

  it('gives every other locator property bound to the real locator', async () => {
    const locator: Locator = wrap(fakePage()).getByRole('button');
    await expect(locator.textContent()).resolves.toBe('bound');
  });

  it('gives every other page property bound to the real page', () => {
    expect(wrap(fakePage()).url()).toBe('bound');
  });
});
