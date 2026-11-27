/**
 * Real touches on Android's own pickers, the steps a person takes
 * (shyden-labs/playwright-devices#7, AC 4; steps measured on the OnePlus
 * CPH2653, Android 16, Chrome 157, 2026-11-18).
 *
 * The screen is read with a uiautomator dump and touched with
 * `adb shell input tap`, Android's own input service.
 */
import { basename } from 'node:path';
import { centreOfFirstDescribed, centreOfText, rectOfResourceId } from './android-screen.ts';
import { androidSwipeArgs, type Adb } from './finger-scroll.ts';
import type { PageArea } from './android-page-map.ts';
import type { ScreenPoint, WdaClock } from './wda-client.ts';
import { realClock } from './clock.ts';

/**
 * Prints the dump of every window to adb's output instead of a file on the phone. Chrome's
 * <select> list on a tablet is its own window, missing from a plain dump (pixel_tablet emulator,
 * Android 16, run 45005023346). Assumed on the real phone until its run measures it.
 */
export const DUMP_COMMAND = ['exec-out', 'uiautomator', 'dump', '--windows', '/dev/tty'];

/** How often a wait reads the screen again. */
const POLL_MS = 250;

/** The same ceiling as iOS's native pickers: the slowest measured opened in 26 s. */
const NATIVE_CEILING_MS = 60_000;

/** Chrome's page area, under its toolbar (measured on the OnePlus CPH2653, Chrome 157, 2026-11-20). */
export const PAGE_AREA_ID = 'com.android.chrome:id/compositor_view_holder';

/**
 * Chrome's keyboard accessory bar: with the keyboard up it is drawn over the page area's bottom, so the
 * page ends at its top (pixel_9 emulator, run 44991089861: 126 px over the area's bottom).
 */
export const ACCESSORY_BAR_ID = 'com.android.chrome:id/accessory_bar_contents';

/** Chrome's page area in `screen`, cut off at the accessory bar's top when the bar covers its bottom. */
/**
 * Chrome's keyboard accessory view: it starts 16 px above its bar's contents and takes the touches there,
 * so a tap in that strip reaches Chrome, not the page (pixel_tablet emulator, run 45040015654).
 */
export const ACCESSORY_VIEW_ID = 'com.android.chrome:id/keyboard_accessory';

function pageAreaIn(screen: string): PageArea | undefined {
  const whole = rectOfResourceId(screen, PAGE_AREA_ID);
  if (whole === undefined) return undefined;
  const bar = rectOfResourceId(screen, ACCESSORY_BAR_ID);
  const area = bar === undefined || bar.y >= whole.y + whole.height ? whole : { ...whole, height: bar.y - whole.y };
  const view = rectOfResourceId(screen, ACCESSORY_VIEW_ID);
  if (view === undefined || view.y >= area.y + area.height) return area;
  return { ...area, coveredFrom: view.y };
}

/** Chrome is open before any tap, so its page area is listed at once; a short ceiling. */
const PAGE_AREA_CEILING_MS = 5_000;

/** Playwright key names and the Android key events `adb shell input keyevent` sends for them. */
const KEY_EVENTS = new Map([
  ['Enter', 'KEYCODE_ENTER'],
  ['Escape', 'KEYCODE_ESCAPE'],
]);

/** Printable ASCII: all `adb shell input text` can type. */
const TYPABLE = /^[\x20-\x7e]*$/;

/** `text` for `adb shell input text`: spaces as %s, then quoted for the phone's shell. */
function inputTextArgument(text: string): string {
  if (!TYPABLE.test(text)) throw new Error(`adb input text types printable ASCII only; cannot type "${text}"`);
  if (text.includes('%s')) throw new Error(`adb input text reads %s as a space; cannot type "${text}"`);
  const quoteEscape = String.raw`'\''`;
  const escaped = text.replaceAll(' ', '%s').replaceAll("'", quoteEscape);
  return `'${escaped}'`;
}

export interface AndroidScreenOptions {
  adb: Adb;
  clock?: WdaClock;
}

export function connectAndroidScreen({ adb, clock = realClock }: AndroidScreenOptions) {
  const dump = () => adb(DUMP_COMMAND);
  const started = clock.now();
  /** Every touch sent, with when and where: the pixel_tablet's Colour tap reached nothing on the page and nothing said where it went (run 45020752863). */
  const sent: string[] = [];
  const at = ({ x, y }: ScreenPoint) => `${Math.round(x)},${Math.round(y)}`;
  const record = (what: string) => sent.push(`${clock.now() - started} ms ${what}`);

  async function touch(point: ScreenPoint): Promise<void> {
    record(`tap at ${at(point)}`);
    await adb(['shell', 'input', 'tap', String(Math.round(point.x)), String(Math.round(point.y))]);
  }

  /** The first of `texts` the screen lists now, with its centre. */
  async function firstShown(texts: string[]): Promise<{ text: string; at: ScreenPoint } | undefined> {
    const screen = await dump();
    for (const text of texts) {
      const at = centreOfText(screen, text);
      if (at !== undefined) return { text, at };
    }
    return undefined;
  }

  /** Asks `look` until it answers, failing at the ceiling with `failure`. */
  async function waitFor<T>(look: () => Promise<T | undefined>, failure: string, ceilingMs = NATIVE_CEILING_MS): Promise<T> {
    const deadline = clock.now() + ceilingMs;
    // Each look waits for the one before: a recursive wait, not a loop.
    const attempt = async (): Promise<T> => {
      const found = await look();
      if (found !== undefined) return found;
      if (clock.now() >= deadline) throw new Error(failure);
      await clock.sleep(POLL_MS);
      return attempt();
    };
    return attempt();
  }

  return {
    /** The whole uiautomator dump of the screen: kept with the screenshot when a test fails. */
    source: dump,

    /** The screen as PNG bytes, sent base64 so adb's text output keeps them whole: the evidence kept when a test fails. */
    async screenshot(): Promise<Buffer> {
      return Buffer.from((await adb(['exec-out', 'screencap -p | base64'])).trim(), 'base64');
    },

    /** A real touch at a screen point, in the phone's pixels. */
    tapAt: touch,

    /** One real finger dragged from `from` to `to`, in the phone's pixels. */
    async swipe(from: ScreenPoint, to: ScreenPoint): Promise<void> {
      record(`drag from ${at(from)} to ${at(to)}`);
      await adb(androidSwipeArgs(from, to));
    },

    /** Every tap and drag sent so far, in order, with when (ms since connecting) and where, in the phone's pixels. */
    touchesSent: (): string[] => [...sent],

    /**
     * The phone's crash and event logs, read once: Chrome left the screen mid-journey on both emulators with
     * nothing saying why (run 45020752863).
     */
    deviceLog: () => adb(['logcat', '-d', '-b', 'crash', '-b', 'events', '-t', '2000']),

    /**
     * What the low-memory killer and the activity manager logged, read once: on the pixel_tablet emulator
     * Chrome and three other apps died within 0.5 s of a Play services update (run 45027508984), and the
     * crash and event logs cannot say whether memory ran out.
     */
    memoryLog: () => adb(['logcat', '-d', '-b', 'main', '-b', 'system', '-s', 'lmkd', 'lowmemorykiller', 'ActivityManager', '-t', '2000']),

    /** Types `text` into the focused field through Android's input service. */
    async typeText(text: string): Promise<void> {
      record(`type ${JSON.stringify(text)}`);
      await adb(['shell', 'input', 'text', inputTextArgument(text)]);
    },

    /** Presses a key as Android's own key event (shyden-labs/playwright-devices#67); a key with none routed is refused, naming it. */
    async pressKey(key: string): Promise<void> {
      const code = KEY_EVENTS.get(key);
      if (code === undefined) {
        throw new Error(`no key event routed for "${key}" on Android; keys routed: ${[...KEY_EVENTS.keys()].join(', ')}`);
      }
      await adb(['shell', 'input', 'keyevent', code]);
    },

    /** Where Chrome draws the page on the screen, read afresh: its toolbar moves as the page scrolls. */
    async pageArea(): Promise<PageArea> {
      return waitFor(
        async () => pageAreaIn(await dump()),
        `Chrome's page area (${PAGE_AREA_ID}) was not on the screen within ${PAGE_AREA_CEILING_MS} ms`,
        PAGE_AREA_CEILING_MS,
      );
    },

    /** Touches the first of `texts` the screen lists, waiting while a slow picker opens; answers the text touched. */
    async tapFirstShown(texts: string[]): Promise<string> {
      const named = texts.map((text) => `"${text}"`).join(', ');
      const hit = await waitFor(() => firstShown(texts), `none of ${named} showed within ${NATIVE_CEILING_MS} ms; nothing was touched`);
      await touch(hit.at);
      return hit.text;
    },

    /** Looks once, without waiting, and touches the first of `texts` listed; undefined when none showed. */
    async tapIfShown(texts: string[]): Promise<string | undefined> {
      const hit = await firstShown(texts);
      if (hit === undefined) return undefined;
      await touch(hit.at);
      return hit.text;
    },

    /**
     * Touches `text` once it shows, or answers undefined once no node described `openPrefix` is left: a picker that
     * closed itself. Waits while the picker is open without `text`; fails at the ceiling naming both.
     */
    async tapUnlessClosed(text: string, openPrefix: string, picker: string): Promise<string | undefined> {
      const seen = await waitFor(async () => {
        const screen = await dump();
        const at = centreOfText(screen, text);
        if (at !== undefined) return { at };
        if (centreOfFirstDescribed(screen, openPrefix) === undefined) return { at: undefined };
        return undefined;
      }, `the ${picker} neither closed nor showed "${text}" within ${NATIVE_CEILING_MS} ms`);
      if (seen.at === undefined) return undefined;
      await touch(seen.at);
      return text;
    },

    /**
     * Touches the topmost, then leftmost, node whose description starts with `prefix`, once two dumps in a
     * row agree where it is: a picker's sheet still opening moved the photo 169 px down after the touch was
     * aimed (pixel_9 emulator, run 45035234085).
     */
    async tapFirstDescribed(prefix: string): Promise<void> {
      let previous: ScreenPoint | undefined;
      const at = await waitFor(async () => {
        const now = centreOfFirstDescribed(await dump(), prefix);
        const still = now !== undefined && now.x === previous?.x && now.y === previous.y;
        previous = now;
        return still ? now : undefined;
      }, `nothing described "${prefix}…" showed and held still within ${NATIVE_CEILING_MS} ms; nothing was touched`);
      await touch(at);
    },

    /** Adds a line to the touches sent, with when: what an aim was computed from. */
    note: record,
  };
}

export type AndroidScreen = ReturnType<typeof connectAndroidScreen>;

/** Chrome shows a `<select>`'s options as a native list. */
export async function androidChooseOption(screen: AndroidScreen, option: string): Promise<void> {
  await screen.tapFirstShown([option]);
}

/**
 * The answer a person gives Android's camera prompt. Not Only this time: Android withdraws a one-time
 * permission once the app leaves the screen, ending it, and Chrome was gone behind the chooser (pixel_9
 * emulator, run 44995686112).
 */
const CAMERA_PROMPT_ANSWER = 'While using the app';

/**
 * The chooser's file browser: Files on the OnePlus CPH2653; Media picker on the pixel_9 emulator, which
 * opens the same file browser (run 45007095925).
 */
// Once Android's own photo picker took file choosing, the chooser named it Photos & videos, and it opened the
// same Recent browser (pixel_9 emulator, cdp route, run 45027508984).
const FILE_BROWSER = ['Files', 'Media picker', 'Photos & videos'];

/**
 * The chooser's file browser, then the file (staged first with `stageAndroidFile`). On a fresh phone Chrome
 * first asks to take pictures (pixel_9 emulator, run 44993134413); a person answers it and goes on.
 */
export async function androidChooseFile(screen: AndroidScreen, name: string): Promise<void> {
  if ((await screen.tapFirstShown([...FILE_BROWSER, CAMERA_PROMPT_ANSWER])) === CAMERA_PROMPT_ANSWER) {
    await screen.tapFirstShown(FILE_BROWSER);
  }
  await screen.tapFirstShown([name]);
}

/** How Google's photo picker describes each photo in its grid. */
const PHOTO_DESCRIPTION = 'Photo taken on';

/**
 * Google's photo picker: the newest photo (the staged one), then Done when it asks. On a real phone it selects on
 * tap and returns only on Done; on the pixel_9 emulator it returned on the tap itself (run 45027508984).
 */
export async function androidChoosePhoto(screen: AndroidScreen): Promise<void> {
  await screen.tapFirstDescribed(PHOTO_DESCRIPTION);
  await screen.tapUnlessClosed('Done', PHOTO_DESCRIPTION, 'photo picker');
}

/**
 * Closes a picker a failed step left open: one left open swallowed the next
 * run's touches. A photo picker with a photo selected offers Done but no Cancel.
 */
export async function androidClosePicker(screen: AndroidScreen): Promise<void> {
  await screen.tapIfShown(['Cancel']);
  await screen.tapIfShown(['Done']);
}

/** Asks the media scanner to index `path`, so the pickers list it. Assumed on Android 16 until the phone run measures it. */
function indexCommand(path: string): string[] {
  return ['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${path}`];
}

/** Pushes `localPath` into `folder` on the phone and has it indexed; answers the cleanup that removes it again. */
export async function stageAndroidFile(adb: Adb, localPath: string, folder: string): Promise<() => Promise<void>> {
  const onPhone = `${folder}/${basename(localPath)}`;
  await adb(['push', localPath, onPhone]);
  // adb push keeps the checkout's time, and the Files picker's Recent list shows newer files only: on the
  // OnePlus (2026-11-24) a 3-day-old copy never showed. Dated now, it is the newest.
  await adb(['shell', 'touch', onPhone]);
  await adb(indexCommand(onPhone));
  return async () => {
    await adb(['shell', 'rm', '-f', onPhone]);
    await adb(indexCommand(onPhone));
  };
}
