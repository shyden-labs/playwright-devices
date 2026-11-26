import { describe, expect, it } from 'vitest';
import { MARKER_CSS_SIZE, screenMap } from '../../src/devices/screen-map.ts';

describe('screenMap', () => {
  it('is measured with a 100 by 100 CSS pixel marker', () => {
    expect(MARKER_CSS_SIZE).toBe(100);
  });

  it('maps the centre of a page box to the screen through the marker’s origin and scale', () => {
    // Marker drawn at CSS (10, 20); WebDriverAgent reports it at (15, 130), 50 points wide: scale 0.5.
    const map = screenMap({ cssLeft: 10, cssTop: 20 }, { x: 15, y: 130, width: 50, height: 50 });

    expect(map.centreOf({ x: 100, y: 200, width: 40, height: 20 })).toEqual({ x: 70, y: 225 });
  });

  it('keeps a scale of 1 when the screen shows CSS pixels one to one', () => {
    const map = screenMap({ cssLeft: 0, cssTop: 0 }, { x: 0, y: 97, width: 100, height: 100 });

    expect(map.centreOf({ x: 0, y: 0, width: 10, height: 10 })).toEqual({ x: 5, y: 102 });
  });

  it('allows for WebDriverAgent rounding a fractional rectangle outward, scaling by the shorter side', () => {
    // Measured on the iPhone Air with the keyboard up, 2026-11-20: 100 by 102 at (0, 65).
    const map = screenMap({ cssLeft: 0, cssTop: 0 }, { x: 0, y: 65, width: 100, height: 102 });

    expect(map.centreOf({ x: 16, y: 355, width: 265, height: 44 })).toEqual({ x: 148.5, y: 442 });
  });

  it('refuses a marker whose sides differ by more than that rounding (2 points), naming where it was read', () => {
    expect(() => screenMap({ cssLeft: 0, cssTop: 0 }, { x: 0, y: 7, width: 100, height: 103 })).toThrow(
      'the marker read back 100 by 103 points at (0, 7), not square: the page is zoomed or the marker is clipped',
    );
  });
});
