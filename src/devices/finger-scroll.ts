/**
 * One real finger scroll on each device route (shyden-labs/playwright-devices#7).
 *
 * The finger drags up the middle of the screen from 45% to 15% of its height:
 * the span measured on the OnePlus, 20 of 20 scrolled
 * (evidence/android-swipe-2026-11-17.txt).
 */
import type { ScreenPoint, ScreenSize } from './wda-client.ts';

const START = 0.45;
const END = 0.15;

/** The measured Android swipe took 400 ms. */
const ANDROID_SWIPE_MS = 400;

export function scrollSpan({ width, height }: ScreenSize): { from: ScreenPoint; to: ScreenPoint } {
  const x = Math.round(width / 2);
  return { from: { x, y: Math.round(height * START) }, to: { x, y: Math.round(height * END) } };
}

/** The part of the WebDriverAgent client a scroll needs. */
export interface IosSwiper {
  windowSize(): Promise<ScreenSize>;
  swipe(from: ScreenPoint, to: ScreenPoint): Promise<void>;
}

export async function iosFingerScroll(wda: IosSwiper): Promise<void> {
  const { from, to } = scrollSpan(await wda.windowSize());
  await wda.swipe(from, to);
}

/** Reads `adb shell wm size`; an override size, when set, is what input coordinates use. */
export function parseWmSize(output: string): ScreenSize {
  const sizes = [...output.matchAll(/(Physical|Override) size: (\d+)x(\d+)/g)];
  const chosen = sizes.find((size) => size[1] === 'Override') ?? sizes[0];
  if (!chosen) throw new Error(`\`adb shell wm size\` printed no size: ${output.trim()}`);
  return { width: Number(chosen[2]), height: Number(chosen[3]) };
}

/** Runs `adb` with these arguments and answers what it printed. */
export type Adb = (args: string[]) => Promise<string>;

export async function androidFingerScroll(adb: Adb): Promise<void> {
  const { from, to } = scrollSpan(parseWmSize(await adb(['shell', 'wm', 'size'])));
  await adb(['shell', 'input', 'swipe', ...[from.x, from.y, to.x, to.y, ANDROID_SWIPE_MS].map(String)]);
}
