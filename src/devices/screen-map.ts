/**
 * Page coordinates to screen points on iOS (shyden-labs/playwright-devices#7).
 *
 * Safari's toolbar and zoom sit between the page and the screen, so the page
 * draws a fixed square marker and WebDriverAgent reads where it landed: that
 * gives the page's origin on the screen and its scale.
 */

/** The marker's side, in CSS pixels. */
export const MARKER_CSS_SIZE = 100;

/** A rectangle: Playwright's `boundingBox()` or WebDriverAgent's element rect. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the marker was drawn on the page, in CSS pixels from the viewport's top left. */
export interface MarkerPlace {
  cssLeft: number;
  cssTop: number;
}

/**
 * WebDriverAgent reports whole points and rounds a fractional rectangle
 * outward, adding up to a point at each edge: with the keyboard up the iPhone
 * Air read the marker as 100 by 102 (2026-11-20).
 */
const ROUNDING_POINTS = 2;

export function screenMap(place: MarkerPlace, onScreen: Box) {
  if (Math.abs(onScreen.width - onScreen.height) > ROUNDING_POINTS) {
    throw new Error(
      `the marker read back ${onScreen.width} by ${onScreen.height} points at (${onScreen.x}, ${onScreen.y}), not square: the page is zoomed or the marker is clipped`,
    );
  }
  const scale = Math.min(onScreen.width, onScreen.height) / MARKER_CSS_SIZE;
  const originX = onScreen.x - place.cssLeft * scale;
  const originY = onScreen.y - place.cssTop * scale;
  return {
    /** The screen point at the centre of a page box. */
    centreOf(box: Box) {
      return { x: originX + (box.x + box.width / 2) * scale, y: originY + (box.y + box.height / 2) * scale };
    },
  };
}
