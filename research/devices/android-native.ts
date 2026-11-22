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
import { realClock, type ScreenPoint, type ScreenRect, type WdaClock } from './wda-client.ts';

/**
 * Prints the dump to adb's output instead of a file on the phone.
 * Assumed, not yet measured on the phone: the first device run checks it.
 */
export const DUMP_COMMAND = ['exec-out', 'uiautomator', 'dump', '/dev/tty'];

/** How often a wait reads the screen again. */
const POLL_MS = 250;

/** The same ceiling as iOS's native pickers: the slowest measured opened in 26 s. */
const NATIVE_CEILING_MS = 60_000;

/** Chrome's page area, under its toolbar (measured on the OnePlus CPH2653, Chrome 157, 2026-11-20). */
export const PAGE_AREA_ID = 'com.android.chrome:id/compositor_view_holder';

/** Chrome is open before any tap, so its page area is listed at once; a short ceiling. */
const PAGE_AREA_CEILING_MS = 5_000;

/** Printable ASCII: all `adb shell input text` can type. */
const TYPABLE = /^[\x20-\x7e]*$/;

/** `text` for `adb shell input text`: spaces as %s, then quoted for the phone's shell. */
function inputTextArgument(text: string): string {
  if (!TYPABLE.test(text)) throw new Error(`adb input text types printable ASCII only; cannot type "${text}"`);
  if (text.includes('%s')) throw new Error(`adb input text reads %s as a space; cannot type "${text}"`);
  return `'${text.replaceAll(' ', '%s').replaceAll("'", "'\\''")}'`;
}

export interface AndroidScreenOptions {
  adb: Adb;
  clock?: WdaClock;
}

export function connectAndroidScreen({ adb, clock = realClock }: AndroidScreenOptions) {
  const dump = () => adb(DUMP_COMMAND);

  async function touch({ x, y }: ScreenPoint): Promise<void> {
    await adb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
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
    for (;;) {
      const found = await look();
      if (found !== undefined) return found;
      if (clock.now() >= deadline) throw new Error(failure);
      await clock.sleep(POLL_MS);
    }
  }

  return {
    /** The screen as PNG bytes, sent base64 so adb's text output keeps them whole: the evidence kept when a test fails. */
    async screenshot(): Promise<Buffer> {
      return Buffer.from((await adb(['exec-out', 'screencap -p | base64'])).trim(), 'base64');
    },

    /** A real touch at a screen point, in the phone's pixels. */
    tapAt: touch,

    /** One real finger dragged from `from` to `to`, in the phone's pixels. */
    async swipe(from: ScreenPoint, to: ScreenPoint): Promise<void> {
      await adb(androidSwipeArgs(from, to));
    },

    /** Types `text` into the focused field through Android's input service. */
    async typeText(text: string): Promise<void> {
      await adb(['shell', 'input', 'text', inputTextArgument(text)]);
    },

    /** Where Chrome draws the page on the screen, read afresh: its toolbar moves as the page scrolls. */
    async pageArea(): Promise<ScreenRect> {
      return waitFor(
        async () => rectOfResourceId(await dump(), PAGE_AREA_ID),
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

    /** Touches the topmost, then leftmost, node whose description starts with `prefix`, waiting for it. */
    async tapFirstDescribed(prefix: string): Promise<void> {
      const at = await waitFor(
        async () => centreOfFirstDescribed(await dump(), prefix),
        `nothing described "${prefix}…" showed within ${NATIVE_CEILING_MS} ms; nothing was touched`,
      );
      await touch(at);
    },
  };
}

export type AndroidScreen = ReturnType<typeof connectAndroidScreen>;

/** Chrome shows a `<select>`'s options as a native list. */
export async function androidChooseOption(screen: AndroidScreen, option: string): Promise<void> {
  await screen.tapFirstShown([option]);
}

/** The chooser's Files, then the file (staged first with `stageAndroidFile`). */
export async function androidChooseFile(screen: AndroidScreen, name: string): Promise<void> {
  await screen.tapFirstShown(['Files']);
  await screen.tapFirstShown([name]);
}

/** Google's photo picker: the newest photo (the staged one), then Done; it selects on tap and returns only on Done. */
export async function androidChoosePhoto(screen: AndroidScreen): Promise<void> {
  await screen.tapFirstDescribed('Photo taken on');
  await screen.tapFirstShown(['Done']);
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
  await adb(indexCommand(onPhone));
  return async () => {
    await adb(['shell', 'rm', '-f', onPhone]);
    await adb(indexCommand(onPhone));
  };
}
