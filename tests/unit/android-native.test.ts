import { describe, expect, it } from 'vitest';
import {
  DUMP_COMMAND,
  androidChooseFile,
  androidChooseOption,
  androidChoosePhoto,
  androidClosePicker,
  connectAndroidScreen,
  stageAndroidFile,
} from '../../src/devices/android-native.ts';
import type { WdaClock } from '../../src/devices/wda-client.ts';

/** No wait here is longer than this, so a fake clock past it means a wait without a ceiling. */
const LONGEST_CEILING_MS = 60_000;

/** A clock that only moves when the code sleeps. */
function fakeClock(): WdaClock {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      if (t > LONGEST_CEILING_MS) return Promise.reject(new Error(`waited past ${LONGEST_CEILING_MS} ms: a wait has no ceiling`));
      return Promise.resolve();
    },
  };
}

/** One node a dump lists. */
interface Node {
  id?: string;
  text?: string;
  desc?: string;
  bounds: [number, number, number, number];
}

function dumpOf(nodes: Node[]): string {
  const lines = nodes.map(
    ({ id = '', text = '', desc = '', bounds: [l, t, r, b] }) =>
      `<node text="${text}" resource-id="${id}" content-desc="${desc}" bounds="[${l},${t}][${r},${b}]" />`,
  );
  return `<hierarchy rotation="0">${lines.join('')}</hierarchy>UI hierchary dumped to: /dev/tty`;
}

/** An adb stand-in: each dump answers the screen for that look (the last one repeats); every call is recorded. */
function fakeAdb(screens: Node[][]) {
  const calls: string[] = [];
  let looks = 0;
  const adb = (args: string[]) => {
    calls.push(args.join(' '));
    if (args.join(' ') === DUMP_COMMAND.join(' ')) {
      const screen = screens[Math.min(looks, screens.length - 1)] ?? [];
      looks += 1;
      return Promise.resolve(dumpOf(screen));
    }
    return Promise.resolve('');
  };
  return { adb, calls, taps: () => calls.filter((call) => call.startsWith('shell input tap')) };
}

const GREEN: Node = { text: 'Green', bounds: [100, 900, 980, 1040] };
const FILES: Node = { text: 'Files', bounds: [0, 2000, 200, 2100] };
const FILE: Node = { text: 'device-journey.txt', bounds: [0, 400, 1080, 600] };
const PHOTO: Node = { desc: 'Photo taken on 20 Nov 2026, 10:01', bounds: [100, 500, 400, 800] };
const DONE: Node = { text: 'Done', bounds: [800, 2200, 1000, 2300] };
const CANCEL: Node = { text: 'Cancel', bounds: [0, 2200, 200, 2300] };

describe('connectAndroidScreen', () => {
  it('reads the screen with a uiautomator dump to the terminal', () => {
    expect(DUMP_COMMAND).toEqual(['exec-out', 'uiautomator', 'dump', '/dev/tty']);
  });

  it('tapFirstShown touches the centre of the first listed text with adb input tap, and answers it', async () => {
    const device = fakeAdb([[GREEN, DONE]]);
    const screen = connectAndroidScreen({ adb: device.adb, clock: fakeClock() });

    expect(await screen.tapFirstShown(['Blue', 'Green'])).toBe('Green');
    expect(device.taps()).toEqual(['shell input tap 540 970']);
  });

  it('tapFirstShown keeps looking while a slow picker opens', async () => {
    const device = fakeAdb([[], [], [], [GREEN]]);
    const clock = fakeClock();
    const screen = connectAndroidScreen({ adb: device.adb, clock });

    expect(await screen.tapFirstShown(['Green'])).toBe('Green');
    expect(clock.now()).toBeGreaterThan(0);
  });

  it('tapFirstShown fails at 60 s naming every text, and touches nothing', async () => {
    const device = fakeAdb([[]]);
    const clock = fakeClock();
    const screen = connectAndroidScreen({ adb: device.adb, clock });

    await expect(screen.tapFirstShown(['Files', 'Browse'])).rejects.toThrow(
      'none of "Files", "Browse" showed within 60000 ms; nothing was touched',
    );
    expect(clock.now()).toBe(60_000);
    expect(device.taps()).toEqual([]);
  });

  it('tapIfShown looks once, without waiting', async () => {
    const device = fakeAdb([[DONE]]);
    const clock = fakeClock();
    const screen = connectAndroidScreen({ adb: device.adb, clock });

    expect(await screen.tapIfShown(['Cancel'])).toBeUndefined();
    expect(await screen.tapIfShown(['Done'])).toBe('Done');
    expect(clock.now()).toBe(0);
    expect(device.taps()).toEqual(['shell input tap 900 2250']);
  });

  it('tapFirstDescribed waits for a node whose description starts with the prefix, and touches it', async () => {
    const device = fakeAdb([[], [PHOTO]]);
    const screen = connectAndroidScreen({ adb: device.adb, clock: fakeClock() });

    await screen.tapFirstDescribed('Photo taken on');
    expect(device.taps()).toEqual(['shell input tap 250 650']);
  });

  it('tapFirstDescribed fails at 60 s naming the prefix', async () => {
    const device = fakeAdb([[]]);
    const screen = connectAndroidScreen({ adb: device.adb, clock: fakeClock() });

    await expect(screen.tapFirstDescribed('Photo taken on')).rejects.toThrow(
      'nothing described "Photo taken on…" showed within 60000 ms; nothing was touched',
    );
  });
});

describe('real input on Android', () => {
  const PAGE_AREA: Node = { id: 'com.android.chrome:id/compositor_view_holder', bounds: [0, 160, 1440, 3014] };

  it('pageArea answers where Chrome draws the page, read afresh from the screen', async () => {
    const device = fakeAdb([[], [PAGE_AREA]]);
    const screen = connectAndroidScreen({ adb: device.adb, clock: fakeClock() });
    expect(await screen.pageArea()).toEqual({ x: 0, y: 160, width: 1440, height: 2854 });
  });

  it("pageArea fails at 5 s when Chrome's page area is not on the screen", async () => {
    const device = fakeAdb([[]]);
    const clock = fakeClock();
    const screen = connectAndroidScreen({ adb: device.adb, clock });
    await expect(screen.pageArea()).rejects.toThrow(
      "Chrome's page area (com.android.chrome:id/compositor_view_holder) was not on the screen within 5000 ms",
    );
    expect(clock.now()).toBe(5_000);
  });

  it('tapAt touches the point, rounded to whole pixels', async () => {
    const device = fakeAdb([[]]);
    await connectAndroidScreen({ adb: device.adb, clock: fakeClock() }).tapAt({ x: 131.6, y: 367.4 });
    expect(device.taps()).toEqual(['shell input tap 132 367']);
  });

  it("typeText sends the text through the phone's shell quoted, with spaces as %s", async () => {
    const device = fakeAdb([[]]);
    await connectAndroidScreen({ adb: device.adb, clock: fakeClock() }).typeText("Ana's tea & toast");
    expect(device.calls).toEqual(["shell input text 'Ana'\\''s%stea%s&%stoast'"]);
  });

  it("pressKey sends Enter and Escape as the phone's own key events (shyden-labs/playwright-devices#67)", async () => {
    const device = fakeAdb([[]]);
    const screen = connectAndroidScreen({ adb: device.adb, clock: fakeClock() });
    await screen.pressKey('Enter');
    await screen.pressKey('Escape');
    expect(device.calls).toEqual(['shell input keyevent KEYCODE_ENTER', 'shell input keyevent KEYCODE_ESCAPE']);
  });

  it('swipe drags one finger between the points over 400 ms, rounded to whole pixels, as the measured scroll did', async () => {
    const device = fakeAdb([[]]);
    await connectAndroidScreen({ adb: device.adb, clock: fakeClock() }).swipe({ x: 640.4, y: 668.6 }, { x: 640, y: 356 });
    expect(device.calls).toEqual(['shell input swipe 640 669 640 356 400']);
  });

  it('pressKey refuses a key it has no key event for, naming it and sending nothing', async () => {
    const device = fakeAdb([[]]);
    await expect(connectAndroidScreen({ adb: device.adb, clock: fakeClock() }).pressKey('Tab')).rejects.toThrow(
      'no key event routed for "Tab" on Android; keys routed: Enter, Escape',
    );
    expect(device.calls).toEqual([]);
  });

  it('typeText refuses what adb input cannot type, sending nothing', async () => {
    const device = fakeAdb([[]]);
    const screen = connectAndroidScreen({ adb: device.adb, clock: fakeClock() });
    await expect(screen.typeText('café')).rejects.toThrow('adb input text types printable ASCII only; cannot type "café"');
    await expect(screen.typeText('100%sure')).rejects.toThrow('adb input text reads %s as a space; cannot type "100%sure"');
    expect(device.calls).toEqual([]);
  });
});

describe('screenshot', () => {
  it('answers the screen as PNG bytes, sent base64 so adb’s text output keeps them whole', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const calls: string[] = [];
    const adb = (args: string[]) => {
      calls.push(args.join(' '));
      return Promise.resolve(`${png.toString('base64')}\n`);
    };
    expect(await connectAndroidScreen({ adb, clock: fakeClock() }).screenshot()).toEqual(png);
    expect(calls).toEqual(['exec-out screencap -p | base64']);
  });
});

describe('the steps a person takes on Android', () => {
  it('<select>: touches the option in Chrome’s native list', async () => {
    const device = fakeAdb([[GREEN]]);
    await androidChooseOption(connectAndroidScreen({ adb: device.adb, clock: fakeClock() }), 'Green');
    expect(device.taps()).toEqual(['shell input tap 540 970']);
  });

  it('file: Files, then the file', async () => {
    const device = fakeAdb([[FILES], [FILE]]);
    await androidChooseFile(connectAndroidScreen({ adb: device.adb, clock: fakeClock() }), 'device-journey.txt');
    expect(device.taps()).toEqual(['shell input tap 100 2050', 'shell input tap 540 500']);
  });

  it('photo: the newest photo, then Done', async () => {
    const device = fakeAdb([[PHOTO], [DONE]]);
    await androidChoosePhoto(connectAndroidScreen({ adb: device.adb, clock: fakeClock() }));
    expect(device.taps()).toEqual(['shell input tap 250 650', 'shell input tap 900 2250']);
  });

  it('teardown: Cancel, then Done, whichever shows, without waiting', async () => {
    const device = fakeAdb([[CANCEL, DONE]]);
    const clock = fakeClock();
    await androidClosePicker(connectAndroidScreen({ adb: device.adb, clock }));
    expect(device.taps()).toEqual(['shell input tap 100 2250', 'shell input tap 900 2250']);
    expect(clock.now()).toBe(0);
  });
});

describe('stageAndroidFile', () => {
  it('pushes the file, has it indexed so pickers list it, and removes both on cleanup', async () => {
    const device = fakeAdb([[]]);
    const remove = await stageAndroidFile(device.adb, '/repo/fixtures/device-journey.png', '/sdcard/Pictures');

    expect(device.calls).toEqual([
      'push /repo/fixtures/device-journey.png /sdcard/Pictures/device-journey.png',
      'shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/device-journey.png',
    ]);
    await remove();
    expect(device.calls.slice(2)).toEqual([
      'shell rm -f /sdcard/Pictures/device-journey.png',
      'shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/device-journey.png',
    ]);
  });
});
