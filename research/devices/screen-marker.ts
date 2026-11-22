/**
 * Page boxes to screen points, measured afresh for every tap
 * (shyden-labs/playwright-devices#7).
 *
 * The page draws a 100x100 marker at the box's top left,
 * the phone's accessibility tree says where it landed (WebDriverAgent on iOS,
 * a uiautomator dump on Android), and the marker is removed again. Measuring
 * on every call follows the browser's toolbar, which can move after a scroll.
 */
import { MARKER_CSS_SIZE, screenMap, type Box, type MarkerPlace } from './screen-map.ts';
import { realClock, type ScreenPoint, type WdaClock } from './wda-client.ts';

/** The marker's accessibility label: the name the phone lists it by. */
export const MARKER_LABEL = 'playwright-devices screen marker';

/** The part of Playwright's `Page` the marker needs. */
export interface MarkerPage {
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

/** Where the phone lists an element, by its accessibility label. */
export interface MarkerReader {
  rectOf(accessibilityId: string): Promise<Box>;
}

interface MarkerSpec {
  label: string;
  size: number;
}

/**
 * Draws the marker on the page itself (not fixed to the screen) at the box's top left, and answers that
 * place in the box's own (client) coordinates. On the iOS simulators WebDriverAgent read a fixed marker at
 * the same screen point however far down it was drawn (iPhone 18 Pro: y 62 at top 0 and at top 42; iPhone
 * Duo: y 0 at top 92; run 44991089861), while what scrolls with the page it lists where it shows.
 */
function drawMarker({ label, size, box }: MarkerSpec & { box: Box }): MarkerPlace {
  const marker = document.createElement('div');
  marker.setAttribute('role', 'img');
  marker.setAttribute('aria-label', label);
  Object.assign(marker.style, {
    position: 'absolute',
    left: `${box.x + window.scrollX}px`,
    top: `${box.y + window.scrollY}px`,
    width: `${size}px`,
    height: `${size}px`,
    zIndex: '2147483647',
    pointerEvents: 'none',
    background: 'rgb(255, 0, 255)',
  });
  document.body.append(marker);
  return { cssLeft: box.x, cssTop: box.y };
}

function removeMarker({ label }: MarkerSpec): void {
  for (const marker of document.querySelectorAll(`[aria-label="${label}"]`)) marker.remove();
}

/** How long the page may take to stop moving after a keyboard shows or hides, or the toolbar moves. */
const SETTLE_CEILING_MS = 5_000;

/** Pause between reads while the page settles. */
const SETTLE_POLL_MS = 100;

/** Reads the marker until two reads in a row agree, failing at the ceiling naming the last two. */
async function settledRect(reader: MarkerReader, clock: WdaClock): Promise<Box> {
  const deadline = clock.now() + SETTLE_CEILING_MS;
  let previous = await reader.rectOf(MARKER_LABEL);
  for (;;) {
    const current = await reader.rectOf(MARKER_LABEL);
    if (JSON.stringify(current) === JSON.stringify(previous)) return current;
    if (clock.now() >= deadline) {
      throw new Error(
        `the marker did not settle within ${SETTLE_CEILING_MS} ms; last two reads: ${JSON.stringify(previous)} then ${JSON.stringify(current)}`,
      );
    }
    previous = current;
    await clock.sleep(SETTLE_POLL_MS);
  }
}

/**
 * A `toScreen` for the page stand-in: the screen point at the centre of a page
 * box. The marker is read until two reads agree: right after typing on the
 * iPhone Air it read back 100 by 102 points while the keyboard moved the page
 * (2026-11-20).
 */
export function screenPointsOf(page: MarkerPage, reader: MarkerReader, clock: WdaClock = realClock): (box: Box) => Promise<ScreenPoint> {
  const spec: MarkerSpec = { label: MARKER_LABEL, size: MARKER_CSS_SIZE };
  return async (box) => {
    const place = await page.evaluate(drawMarker, { ...spec, box });
    try {
      return screenMap(place, await settledRect(reader, clock)).centreOf(box);
    } finally {
      await page.evaluate(removeMarker, spec);
    }
  };
}
