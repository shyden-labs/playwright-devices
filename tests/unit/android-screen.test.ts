import { describe, expect, it } from 'vitest';
import { centreOfText } from '../../research/devices/android-screen.ts';

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
