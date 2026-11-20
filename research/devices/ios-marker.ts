/**
 * Page boxes to iOS screen points, measured afresh for every tap
 * (shyden-labs/playwright-devices#7).
 *
 * The page draws a fixed 100x100 marker at the viewport's top left,
 * WebDriverAgent reads where it landed, and the marker is removed again.
 * Measuring on every call follows Safari's toolbar, which can move after a
 * scroll.
 */
import { MARKER_CSS_SIZE, screenMap, type Box } from './screen-map.ts';
import type { ScreenPoint } from './wda-client.ts';

/** The marker's accessibility label: the name WebDriverAgent finds it by. */
export const MARKER_LABEL = 'playwright-devices screen marker';

/** The part of Playwright's `Page` the marker needs. */
export interface MarkerPage {
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

/** The part of the WebDriverAgent client the marker needs. */
export interface MarkerReader {
  rectOf(accessibilityId: string): Promise<Box>;
}

interface MarkerSpec {
  label: string;
  size: number;
}

function drawMarker({ label, size }: MarkerSpec): void {
  const marker = document.createElement('div');
  marker.setAttribute('role', 'img');
  marker.setAttribute('aria-label', label);
  Object.assign(marker.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: `${size}px`,
    height: `${size}px`,
    zIndex: '2147483647',
    pointerEvents: 'none',
    background: 'rgb(255, 0, 255)',
  });
  document.body.append(marker);
}

function removeMarker({ label }: MarkerSpec): void {
  for (const marker of document.querySelectorAll(`[aria-label="${label}"]`)) marker.remove();
}

/** A `toScreen` for the iOS page: the screen point at the centre of a page box. */
export function screenPointsOf(page: MarkerPage, reader: MarkerReader): (box: Box) => Promise<ScreenPoint> {
  const spec: MarkerSpec = { label: MARKER_LABEL, size: MARKER_CSS_SIZE };
  return async (box) => {
    await page.evaluate(drawMarker, spec);
    try {
      const onScreen = await reader.rectOf(MARKER_LABEL);
      return screenMap({ cssLeft: 0, cssTop: 0 }, onScreen).centreOf(box);
    } finally {
      await page.evaluate(removeMarker, spec);
    }
  };
}
