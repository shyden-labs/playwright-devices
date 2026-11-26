/**
 * Page boxes to Android screen pixels (shyden-labs/playwright-devices#7).
 *
 * Chrome's page content is not in the uiautomator dump (measured on the
 * OnePlus CPH2653, 2026-11-20), so no marker can be found there. Instead the
 * dump gives Chrome's page area, whose bottom edge is the page's; the page
 * reports its visual viewport; and the content's top is the area's bottom less
 * the viewport's height on screen. Both are read afresh for every tap, since
 * Chrome's toolbar hides and shows as the page scrolls.
 */
import type { Box } from './screen-map.ts';
import type { ScreenPoint, ScreenRect, WdaClock } from './wda-client.ts';
import { realClock } from './clock.ts';

/** The page's visual viewport, as the page reports it. */
export interface PageViewport {
  devicePixelRatio: number;
  offsetLeft: number;
  offsetTop: number;
  scale: number;
  height: number;
}

/** The centre of `box` (CSS pixels in the page's viewport) in the phone's pixels. */
export function androidPagePoint(box: Box, viewport: PageViewport, area: ScreenRect): ScreenPoint {
  const pixels = viewport.scale * viewport.devicePixelRatio;
  const contentTop = area.y + area.height - viewport.height * pixels;
  return {
    x: area.x + (box.x + box.width / 2 - viewport.offsetLeft) * pixels,
    y: contentTop + (box.y + box.height / 2 - viewport.offsetTop) * pixels,
  };
}

/** The part of Playwright's `Page` the map needs. */
export interface ViewportPage {
  evaluate(fn: () => PageViewport): Promise<PageViewport>;
}

/** The part of the Android screen the map needs. */
export interface PageAreaReader {
  pageArea(): Promise<ScreenRect>;
}

function readViewport(): PageViewport {
  const viewport = window.visualViewport;
  return {
    devicePixelRatio: window.devicePixelRatio,
    offsetLeft: viewport?.offsetLeft ?? 0,
    offsetTop: viewport?.offsetTop ?? 0,
    scale: viewport?.scale ?? 1,
    height: viewport?.height ?? window.innerHeight,
  };
}

/** How long the page may take to settle after a keyboard shows or hides, or the toolbar moves. */
const SETTLE_CEILING_MS = 5_000;

/** Pause between reads while the page settles. */
const SETTLE_POLL_MS = 100;

/**
 * A `toScreen` for the Android page stand-in: the screen point at the centre
 * of a page box. The page's viewport and Chrome's page area are read until two
 * reads in a row agree: right after typing, the page still reported the old
 * viewport while the screen already showed the keyboard (measured 2026-11-20),
 * and a tap from that mix landed 1,127 pixels too high.
 */
export function androidScreenPointsOf(
  page: ViewportPage,
  screen: PageAreaReader,
  clock: WdaClock = realClock,
): (box: Box) => Promise<ScreenPoint> {
  const read = async () => JSON.stringify({ viewport: await page.evaluate(readViewport), area: await screen.pageArea() });
  return async (box) => {
    const deadline = clock.now() + SETTLE_CEILING_MS;
    // Each read waits for the one before: a recursive wait, not a loop.
    const settle = async (previous: string): Promise<ScreenPoint> => {
      const current = await read();
      if (current === previous) {
        const { viewport, area } = JSON.parse(current) as { viewport: PageViewport; area: ScreenRect };
        return androidPagePoint(box, viewport, area);
      }
      if (clock.now() >= deadline) {
        throw new Error(`the page did not settle within ${SETTLE_CEILING_MS} ms; last two reads: ${previous} then ${current}`);
      }
      await clock.sleep(SETTLE_POLL_MS);
      return settle(current);
    };
    return settle(await read());
  };
}
