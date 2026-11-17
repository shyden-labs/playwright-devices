import { describe, expect, it } from 'vitest';
import { centreOfText, firstByDescription } from '../../research/devices/android-native.ts';

/** A cut-down `uiautomator dump` of Chrome's native <select> list, as the OnePlus writes it. */
const SELECT_LIST = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="android:id/content" class="android.widget.FrameLayout" package="com.android.chrome" bounds="[42,980][1038,1460]">
<node index="0" text="Red" resource-id="android:id/text1" class="android.widget.CheckedTextView" package="com.android.chrome" clickable="true" bounds="[63,1001][1017,1145]" />
<node index="1" text="Green" resource-id="android:id/text1" class="android.widget.CheckedTextView" package="com.android.chrome" clickable="true" bounds="[63,1145][1017,1289]" />
<node index="2" text="Blue" resource-id="android:id/text1" class="android.widget.CheckedTextView" package="com.android.chrome" clickable="true" bounds="[63,1289][1017,1433]" />
</node></hierarchy>`;

describe('centreOfText', () => {
  it('gives the centre of the one node whose text is the label', () => {
    expect(centreOfText(SELECT_LIST, 'Green')).toEqual({ x: 540, y: 1217 });
  });

  it('matches the whole text, not a part of it', () => {
    expect(centreOfText(SELECT_LIST, 'Gree')).toBeUndefined();
  });

  it('reads XML entities in the text', () => {
    const xml = '<node text="Tom &amp; Jerry" bounds="[0,0][10,20]" />';
    expect(centreOfText(xml, 'Tom & Jerry')).toEqual({ x: 5, y: 10 });
  });

  it('refuses a label that two nodes carry, naming how many, so a tap never lands on a guess', () => {
    const xml = '<node text="Files" bounds="[0,0][10,10]" /><node text="Files" bounds="[0,20][10,30]" />';
    expect(() => centreOfText(xml, 'Files')).toThrow('2 nodes carry the text "Files" on screen; a tap needs exactly one');
  });

  it('refuses a node with no readable bounds', () => {
    expect(() => centreOfText('<node text="Green" />', 'Green')).toThrow('the node with the text "Green" has no bounds');
  });
});

describe('firstByDescription', () => {
  const GRID = `<hierarchy>
<node content-desc="Media grid" bounds="[0,300][1080,2200]" />
<node content-desc="Photo taken on Nov 17, 2026 21:29" bounds="[362,300][718,656]" />
<node content-desc="Photo taken on Nov 18, 2026 02:50" bounds="[0,300][356,656]" />
<node content-desc="Photo taken on Nov 16, 2026 10:00" bounds="[0,662][356,1018]" />
</hierarchy>`;

  it('gives the centre of the top-left node whose description starts with the prefix', () => {
    expect(firstByDescription(GRID, 'Photo taken on ')).toEqual({ x: 178, y: 478 });
  });

  it('is undefined while no such node is on screen', () => {
    expect(firstByDescription('<node content-desc="Media grid" bounds="[0,0][1,1]" />', 'Photo taken on ')).toBeUndefined();
  });

  it('refuses a matching node with no readable bounds', () => {
    expect(() => firstByDescription('<node content-desc="Photo taken on x" />', 'Photo taken on ')).toThrow(
      'a node described "Photo taken on x" has no bounds',
    );
  });
});
