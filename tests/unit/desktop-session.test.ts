import type { FileChooser, Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { desktopPage, desktopSession, focusedSelect } from '../../src/devices/desktop-session.ts';

/** A Playwright locator stand-in; records the calls it answers. */
function fakeLocator(name: string, calls: string[]): unknown {
  return {
    name,
    click: () => {
      calls.push(`click ${name}`);
      return Promise.resolve();
    },
    tap: () => {
      calls.push(`playwright tap ${name}`);
      return Promise.resolve();
    },
    textContent: () => Promise.resolve(`text of ${name}`),
    getByText: (text: string) => fakeLocator(`${name} >> text=${text}`, calls),
    first: () => fakeLocator(`${name}.first`, calls),
  };
}

interface FakeSelect {
  labels: string[];
  selected: number;
}

/** A desktop page stand-in: its file chooser listener, keyboard, mouse and focused select are recorded or set. */
function fakePage(calls: string[], select: FakeSelect | null = null, chooserOnWait: FileChooser | null = null) {
  const listeners: ((chooser: FileChooser) => void)[] = [];
  const page = {
    title: () => Promise.resolve('Journey'),
    getByRole: (role: string) => fakeLocator(`role=${role}`, calls),
    getByLabel: (label: string) => fakeLocator(`label=${label}`, calls),
    locator: (selector: string) => fakeLocator(selector, calls),
    on: (event: string, listener: (chooser: FileChooser) => void) => {
      calls.push(`on ${event}`);
      listeners.push(listener);
      return page;
    },
    off: (event: string) => {
      calls.push(`off ${event}`);
      return page;
    },
    waitForEvent: (event: string, options: { timeout: number }) => {
      calls.push(`wait for ${event} up to ${String(options.timeout)} ms`);
      if (chooserOnWait === null) return Promise.reject(new Error('Timeout 60000ms exceeded'));
      // As Playwright does, the chooser a wait resolves with is also handed to every 'filechooser' listener.
      for (const listener of listeners) listener(chooserOnWait);
      return Promise.resolve(chooserOnWait);
    },
    evaluate: () => Promise.resolve(select),
    keyboard: {
      press: (key: string) => {
        calls.push(`key ${key}`);
        return Promise.resolve();
      },
    },
    mouse: {
      move: (x: number, y: number) => {
        calls.push(`mouse move ${String(x)},${String(y)}`);
        return Promise.resolve();
      },
      wheel: (dx: number, dy: number) => {
        calls.push(`mouse wheel ${String(dx)},${String(dy)}`);
        return Promise.resolve();
      },
    },
    viewportSize: () => ({ width: 1280, height: 800 }),
    screenshot: () => Promise.resolve(Buffer.from('desktop screen')),
  };
  return {
    page: page as unknown as Page,
    chooserOpens: (chooser: FileChooser) => {
      for (const listener of listeners) listener(chooser);
    },
  };
}

function fakeChooser(name: string, calls: string[]): FileChooser {
  return {
    setFiles: (files: string) => {
      calls.push(`${name} set ${files}`);
      return Promise.resolve();
    },
  } as unknown as FileChooser;
}

const files = { document: '/files/device-journey.txt', photo: '/files/device-journey.png' };

describe('desktopPage', () => {
  it("makes a locator's tap a real click: a desktop browser has no touch, and a click is its real equivalent (shyden-labs/playwright-devices#68)", async () => {
    const calls: string[] = [];
    const page = desktopPage(fakePage(calls).page);

    await page.getByRole('button').tap();
    await page.getByLabel('Colour').first().tap();
    await page.locator('#list').getByText('Green').tap();

    expect(calls).toEqual(['click role=button', 'click label=Colour.first', 'click #list >> text=Green']);
  });

  it('passes everything else through to the page and locator unchanged', async () => {
    const calls: string[] = [];
    const page = desktopPage(fakePage(calls).page);

    expect(await page.title()).toBe('Journey');
    expect(await page.getByRole('heading').textContent()).toBe('text of role=heading');
    await page.getByRole('button').click();
    expect(calls).toEqual(['click role=button']);
  });
});

describe('desktopSession', () => {
  it('sets the shipped document in the file chooser the previous click opened', async () => {
    const calls: string[] = [];
    const fake = fakePage(calls);
    const session = desktopSession({ page: fake.page, files });

    fake.chooserOpens(fakeChooser('chooser', calls));
    await session.nativeChooseFile();

    expect(calls).toEqual(['on filechooser', 'chooser set /files/device-journey.txt']);
  });

  it('sets the shipped photo in the file chooser the previous click opened', async () => {
    const calls: string[] = [];
    const fake = fakePage(calls);
    const session = desktopSession({ page: fake.page, files });

    fake.chooserOpens(fakeChooser('chooser', calls));
    await session.nativeChoosePhoto();

    expect(calls).toEqual(['on filechooser', 'chooser set /files/device-journey.png']);
  });

  it('uses each file chooser once, waiting up to 60 s for the next when none has opened yet', async () => {
    const calls: string[] = [];
    const fake = fakePage(calls, null, fakeChooser('late chooser', calls));
    const session = desktopSession({ page: fake.page, files });

    fake.chooserOpens(fakeChooser('first chooser', calls));
    await session.nativeChooseFile();
    await session.nativeChoosePhoto();

    expect(calls).toEqual([
      'on filechooser',
      'first chooser set /files/device-journey.txt',
      'wait for filechooser up to 60000 ms',
      'late chooser set /files/device-journey.png',
    ]);
  });

  it('never hands a waited-for chooser on again: the next step gets the chooser its own click opened', async () => {
    // CI run 45993980442 (Chromium, Chrome, Edge): the photo was set on the file field's chooser, the one the
    // document step had waited for, so the photo field's change never ran.
    const calls: string[] = [];
    const fake = fakePage(calls, null, fakeChooser('file chooser', calls));
    const session = desktopSession({ page: fake.page, files });

    await session.nativeChooseFile();
    fake.chooserOpens(fakeChooser('photo chooser', calls));
    await session.nativeChoosePhoto();

    expect(calls).toEqual([
      'on filechooser',
      'wait for filechooser up to 60000 ms',
      'file chooser set /files/device-journey.txt',
      'photo chooser set /files/device-journey.png',
    ]);
  });

  it('fails by name when no file chooser opened, setting nothing', async () => {
    const calls: string[] = [];
    const session = desktopSession({ page: fakePage(calls).page, files });

    await expect(session.nativeChooseFile()).rejects.toThrow(
      'no file chooser opened within 60000 ms: click the file field before nativeChooseFile',
    );
  });

  it('chooses an option in the focused select by arrow keys from the selected one, then Enter, as a person does by keyboard', async () => {
    const calls: string[] = [];
    const session = desktopSession({ page: fakePage(calls, { labels: ['Choose', 'Red', 'Green', 'Blue'], selected: 0 }).page, files });

    await session.nativeChoose('Green');

    expect(calls).toEqual(['on filechooser', 'key ArrowDown', 'key ArrowDown', 'key Enter']);
  });

  it('presses ArrowUp to reach an option above the selected one', async () => {
    const calls: string[] = [];
    const session = desktopSession({ page: fakePage(calls, { labels: ['Red', 'Green', 'Blue'], selected: 2 }).page, files });

    await session.nativeChoose('Red');

    expect(calls).toEqual(['on filechooser', 'key ArrowUp', 'key ArrowUp', 'key Enter']);
  });

  it('fails by name when no select has focus, pressing nothing', async () => {
    const calls: string[] = [];
    const session = desktopSession({ page: fakePage(calls).page, files });

    await expect(session.nativeChoose('Green')).rejects.toThrow('no select has focus: click the select before nativeChoose("Green")');
    expect(calls).toEqual(['on filechooser']);
  });

  it('fails by name when the focused select has no such option, pressing nothing', async () => {
    const calls: string[] = [];
    const session = desktopSession({ page: fakePage(calls, { labels: ['Red', 'Blue'], selected: 0 }).page, files });

    await expect(session.nativeChoose('Green')).rejects.toThrow('the focused select has no option "Green"; it offers: Red, Blue');
    expect(calls).toEqual(['on filechooser']);
  });

  it('scrolls with the mouse wheel over the middle of the page, the desktop equivalent of a finger scroll', async () => {
    const calls: string[] = [];
    const session = desktopSession({ page: fakePage(calls).page, files });

    await session.fingerScroll();

    expect(calls).toEqual(['on filechooser', 'mouse move 640,400', 'mouse wheel 0,240']);
  });

  it('scrolls over the middle of a 1280 by 800 page where the page has no fixed viewport', async () => {
    const calls: string[] = [];
    const fake = fakePage(calls);
    (fake.page as unknown as { viewportSize: () => null }).viewportSize = () => null;

    await desktopSession({ page: fake.page, files }).fingerScroll();

    expect(calls).toEqual(['on filechooser', 'mouse move 640,400', 'mouse wheel 0,240']);
  });

  it("keeps the browser's screenshot as the failure evidence, and stops listening for choosers on close", async () => {
    const calls: string[] = [];
    const session = desktopSession({ page: fakePage(calls).page, files });

    expect(await session.screenshot()).toEqual(Buffer.from('desktop screen'));
    await session.close();

    expect(calls).toEqual(['on filechooser', 'off filechooser']);
  });

  it('hands the page it was given', () => {
    const { page } = fakePage([]);
    expect(desktopSession({ page, files }).page).toBe(page);
  });
});

describe('focusedSelect', () => {
  it("reads the focused select's option labels and selected index, in the page", () => {
    const select = { options: [{ label: 'Red' }, { label: 'Green' }], selectedIndex: 1 };
    expect(focusedSelect({ activeElement: select, isSelect: (element) => element === select })).toEqual({
      labels: ['Red', 'Green'],
      selected: 1,
    });
  });

  it("reads the page's own focused element, a select being an HTMLSelectElement, when run in the page with no view given", () => {
    class HTMLSelectElement {
      options = [{ label: 'Red' }];
      selectedIndex = 0;
    }
    vi.stubGlobal('HTMLSelectElement', HTMLSelectElement);
    vi.stubGlobal('document', { activeElement: new HTMLSelectElement() });

    expect(focusedSelect()).toEqual({ labels: ['Red'], selected: 0 });
    vi.unstubAllGlobals();
  });

  it('answers null when what has focus is not a select', () => {
    expect(focusedSelect({ activeElement: {}, isSelect: () => false })).toBeNull();
  });
});
