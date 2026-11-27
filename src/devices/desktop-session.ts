/**
 * The phone session's desktop equivalents (shyden-labs/playwright-devices#68), so one spec runs on the
 * phones and on every desktop browser. A desktop browser's own input is real, so the page is Playwright's
 * own; each native step becomes what a person does there:
 * - a tap is a click (a desktop browser has no touch);
 * - the file and photo steps set the shipped file in the file chooser the previous click opened;
 * - a native choice moves through the focused select by arrow keys, then Enter;
 * - a finger scroll is the mouse wheel.
 */
import type { FileChooser, Locator, Page } from '@playwright/test';
import type { DeviceSession } from './device-session.ts';
import type { PhoneFiles } from './phone-connect.ts';

/** The phones' native picker ceiling: the slowest measured opened in 26 s. */
const CHOOSER_CEILING_MS = 60_000;

/** One wheel turn: 30% of an 800 px tall page, the share of the screen a finger scroll moves. */
const WHEEL_PX = 240;

/** Locator methods that make a locator, so the result keeps tap as a click. */
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

/** `target`'s property `prop`: a method bound to it, with any locator it makes wrapped by `wrap`. */
function passThrough(target: object, prop: string | symbol, wrap: (locator: Locator) => Locator): unknown {
  const value: unknown = Reflect.get(target, prop, target);
  if (typeof value !== 'function') return value;
  if (typeof prop === 'string' && LOCATOR_MAKERS.has(prop)) {
    return (...args: unknown[]) => wrap((value as (...a: unknown[]) => Locator).apply(target, args));
  }
  return (value as (...a: unknown[]) => unknown).bind(target);
}

/** Playwright's own desktop page, with a locator's tap made a click. */
export function desktopPage(page: Page): Page {
  const wrapLocator = (locator: Locator): Locator =>
    new Proxy(locator, {
      get: (target, prop) => (prop === 'tap' ? () => target.click() : passThrough(target, prop, wrapLocator)),
    });
  return new Proxy(page, { get: (target, prop) => passThrough(target, prop, wrapLocator) });
}

/** The focused select's option labels and selected index, null when what has focus is not a select; run in the page. */
export function focusedSelect(
  view: { activeElement: unknown; isSelect: (element: unknown) => boolean } = {
    activeElement: document.activeElement,
    isSelect: (element) => element instanceof HTMLSelectElement,
  },
): { labels: string[]; selected: number } | null {
  if (!view.isSelect(view.activeElement)) return null;
  const select = view.activeElement as { options: ArrayLike<{ label: string }>; selectedIndex: number };
  return { labels: Array.from(select.options, (option) => option.label), selected: select.selectedIndex };
}

export interface DesktopSessionOptions {
  page: Page;
  files: PhoneFiles;
}

/** The session a desktop project's test gets: the phone's steps as a person takes them at a desktop browser. */
export function desktopSession({ page, files }: DesktopSessionOptions): DeviceSession {
  // A chooser that opened before its step asks for it is kept: the click that opens it comes first.
  const opened: FileChooser[] = [];
  const keep = (chooser: FileChooser) => {
    opened.push(chooser);
    // TEMPORARY diagnostic (shyden-labs/playwright-devices#68): which input each chooser opened for.
    void chooser
      .element()
      .getAttribute('id')
      .then((id) => {
        console.log(`DIAG filechooser for #${String(id)}, ${String(opened.length)} waiting`);
      });
  };
  page.on('filechooser', keep);

  async function nextChooser(): Promise<FileChooser> {
    const waiting = opened.shift();
    if (waiting !== undefined) return waiting;
    try {
      return await page.waitForEvent('filechooser', { timeout: CHOOSER_CEILING_MS });
    } catch (error) {
      throw new Error(`no file chooser opened within ${CHOOSER_CEILING_MS} ms: click the file field before nativeChooseFile`, {
        cause: error,
      });
    }
  }

  return {
    page,
    nativeChooseFile: async () => {
      await (await nextChooser()).setFiles(files.document);
    },
    nativeChoosePhoto: async () => {
      const chooser = await nextChooser();
      await chooser.setFiles(files.photo);
      // TEMPORARY diagnostic (shyden-labs/playwright-devices#68): what the input holds after setFiles.
      const held = await chooser
        .element()
        .evaluate((input) =>
          Array.from((input as HTMLInputElement).files ?? [], (file) => `${file.name} type "${file.type}" ${String(file.size)} B`),
        );
      console.log(
        `DIAG photo input holds: ${JSON.stringify(held)}; result shows "${String(await page.getByTestId('photo-result').textContent())}"`,
      );
    },
    nativeChoose: async (option) => {
      const select = await page.evaluate(focusedSelect, undefined);
      if (select === null) throw new Error(`no select has focus: click the select before nativeChoose("${option}")`);
      const target = select.labels.indexOf(option);
      if (target === -1) throw new Error(`the focused select has no option "${option}"; it offers: ${select.labels.join(', ')}`);
      const key = target > select.selected ? 'ArrowDown' : 'ArrowUp';
      for (let moved = 0; moved < Math.abs(target - select.selected); moved++) await page.keyboard.press(key);
      await page.keyboard.press('Enter');
    },
    fingerScroll: async () => {
      const size = page.viewportSize() ?? { width: 1280, height: 800 };
      await page.mouse.move(size.width / 2, size.height / 2);
      await page.mouse.wheel(0, WHEEL_PX);
    },
    screenshot: () => page.screenshot(),
    close: () => {
      page.off('filechooser', keep);
      return Promise.resolve();
    },
  };
}
