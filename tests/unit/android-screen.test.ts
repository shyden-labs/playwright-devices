import { describe, expect, it } from 'vitest';
import { centreOfFirstDescribed, centreOfText, rectOfLabel } from '../../research/devices/android-screen.ts';

/** A trimmed `uiautomator dump` of Chrome's native <select> list. */
const DUMP = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">
    <node index="0" text="Pear" class="android.widget.CheckedTextView" bounds="[100,900][980,1040]" />
    <node index="1" text="Plum &amp; damson" class="android.widget.CheckedTextView" bounds="[100,1040][980,1180]" />
    <node index="2" text="Pear drop" class="android.widget.CheckedTextView" bounds="[100,1180][980,1320]" />
  </node>
</hierarchy>`;

describe('centreOfText', () => {
  it('answers the centre of the node whose text is exactly the one asked for', () => {
    expect(centreOfText(DUMP, 'Pear')).toEqual({ x: 540, y: 970 });
  });

  it('reads XML entities in the text, so a label with & is found', () => {
    expect(centreOfText(DUMP, 'Plum & damson')).toEqual({ x: 540, y: 1110 });
  });

  it('answers undefined when no node has that text, never a partial match', () => {
    expect(centreOfText(DUMP, 'Pea')).toBeUndefined();
  });

  it('refuses a dump with two nodes of that text, naming the text and the count', () => {
    const twice = DUMP.replace('text="Pear drop"', 'text="Pear"');

    expect(() => centreOfText(twice, 'Pear')).toThrow('2 nodes on the screen read "Pear": cannot tell which to touch');
  });
});

/** A trimmed dump of Google's photo picker: a row of two photos, and one above on the right. */
const PHOTOS = `<hierarchy rotation="0">
  <node text="" content-desc="Photo taken on 20 Nov 2026, 10:01" bounds="[400,500][700,800]" />
  <node text="" content-desc="Photo taken on 20 Nov 2026, 10:02" bounds="[100,500][400,800]" />
  <node text="" content-desc="Photo taken on 19 Nov 2026, 09:00" bounds="[400,200][700,499]" />
  <node text="Done" content-desc="" bounds="[800,2200][1000,2300]" />
</hierarchy>`;

describe('centreOfFirstDescribed', () => {
  it('answers the topmost, then leftmost, node whose description starts with the prefix', () => {
    expect(centreOfFirstDescribed(PHOTOS, 'Photo taken on')).toEqual({ x: 550, y: 349.5 });
  });

  it('answers undefined when no description starts with it', () => {
    expect(centreOfFirstDescribed(PHOTOS, 'Video taken on')).toBeUndefined();
  });
});

describe('rectOfLabel', () => {
  const page = `<hierarchy rotation="0">
  <node text="" content-desc="playwright-devices screen marker" bounds="[0,236][263,499]" />
  <node text="Tap me" content-desc="" bounds="[100,600][500,700]" />
</hierarchy>`;

  it('answers the bounds of the node whose description is the label, as a rectangle', () => {
    expect(rectOfLabel(page, 'playwright-devices screen marker')).toEqual({ x: 0, y: 236, width: 263, height: 263 });
  });

  it('also finds a node whose text is the label', () => {
    expect(rectOfLabel(page, 'Tap me')).toEqual({ x: 100, y: 600, width: 400, height: 100 });
  });

  it('answers undefined when no node has that label, never a partial match', () => {
    expect(rectOfLabel(page, 'playwright-devices screen')).toBeUndefined();
  });
});
