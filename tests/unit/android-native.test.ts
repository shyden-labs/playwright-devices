import { describe, expect, it } from 'vitest';
import {
  DUMP_COMMAND,
  androidChooseFile,
  androidChooseOption,
  androidChoosePhoto,
  androidClosePicker,
  connectAndroidScreen,
  stageAndroidFile,
} from '../../research/devices/android-native.ts';
import type { WdaClock } from '../../research/devices/wda-client.ts';

/** No wait here is longer than this, so a fake clock past it means a wait without a ceiling. */
const LONGEST_CEILING_MS = 60_000;

/** A clock that only moves when the code sleeps. */
function fakeClock(longest = LONGEST_CEILING_MS): WdaClock {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      if (t > longest) return Promise.reject(new Error(`waited past ${longest} ms: a wait has no ceiling`));
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

/** Escapes as uiautomator does: Photos & videos is dumped as Photos &amp; videos. */
const xml = (text: string) => text.replaceAll('&', '&amp;');

function dumpOf(nodes: Node[]): string {
  const lines = nodes.map(
    ({ id = '', text = '', desc = '', bounds: [l, t, r, b] }) =>
      `<node text="${xml(text)}" resource-id="${id}" content-desc="${xml(desc)}" bounds="[${l},${t}][${r},${b}]" />`,
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
const MEDIA_PICKER: Node = { text: 'Media picker', bounds: [0, 1600, 1080, 1700] };
const PHOTOS_AND_VIDEOS: Node = { text: 'Photos & videos', bounds: [0, 1800, 1080, 1900] };
const WHILE_USING: Node = { text: 'While using the app', bounds: [134, 1178, 945, 1322] };
const FILE: Node = { text: 'device-journey.txt', bounds: [0, 400, 1080, 600] };
const PHOTO: Node = { desc: 'Photo taken on 20 Nov 2026, 10:01', bounds: [100, 500, 400, 800] };
const DONE: Node = { text: 'Done', bounds: [800, 2200, 1000, 2300] };
const CANCEL: Node = { text: 'Cancel', bounds: [0, 2200, 200, 2300] };

describe('connectAndroidScreen', () => {
  it('reads every window on the screen with a uiautomator dump to the terminal', () => {
    // Round 16 (run 45005023346): the pixel_tablet showed Chrome's open Colour list, yet a plain
    // dump had no "Green"; the list is its own window, which only --windows reads.
    expect(DUMP_COMMAND).toEqual(['exec-out', 'uiautomator', 'dump', '--windows', '/dev/tty']);
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
      'nothing described "Photo taken on…" showed and held still within 60000 ms; nothing was touched',
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

  it("pageArea ends at the top of Chrome's keyboard accessory bar while it covers the page's bottom", async () => {
    // pixel_9 emulator with the keyboard up (run 44991089861): the touch put the page's bottom at ~1418,
    // where the bar's contents start (1415), not at the area's bottom (1541).
    const device = fakeAdb([
      [],
      [
        { id: 'com.android.chrome:id/compositor_view_holder', bounds: [0, 142, 1080, 1541] },
        { id: 'com.android.chrome:id/accessory_bar_contents', bounds: [0, 1415, 1080, 1541] },
      ],
    ]);
    const screen = connectAndroidScreen({ adb: device.adb, clock: fakeClock() });
    expect(await screen.pageArea()).toEqual({ x: 0, y: 142, width: 1080, height: 1273 });
  });

  it("pageArea gives where Chrome's keyboard accessory view starts covering the page, above its bar's contents", async () => {
    // pixel_tablet emulator, run 45040015654: the view starts 16 px above its contents (848 vs 864); the
    // Colour tap at y 753, 1 px inside the view (752), reached Chrome and never the page.
    const device = fakeAdb([
      [],
      [
        { id: 'com.android.chrome:id/compositor_view_holder', bounds: [0, 48, 2560, 960] },
        { id: 'com.android.chrome:id/keyboard_accessory', bounds: [0, 848, 2560, 960] },
        { id: 'com.android.chrome:id/accessory_bar_contents', bounds: [0, 864, 2560, 960] },
      ],
    ]);
    const screen = connectAndroidScreen({ adb: device.adb, clock: fakeClock() });
    expect(await screen.pageArea()).toEqual({ x: 0, y: 48, width: 2560, height: 816, coveredFrom: 848 });
  });

  it('pageArea keeps the whole area when the accessory bar sits at or below its bottom', async () => {
    const device = fakeAdb([
      [],
      [
        { id: 'com.android.chrome:id/compositor_view_holder', bounds: [0, 142, 1080, 1541] },
        { id: 'com.android.chrome:id/accessory_bar_contents', bounds: [0, 1541, 1080, 1667] },
      ],
    ]);
    const screen = connectAndroidScreen({ adb: device.adb, clock: fakeClock() });
    expect(await screen.pageArea()).toEqual({ x: 0, y: 142, width: 1080, height: 1399 });
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

  it('swipe drags one finger between the points over 400 ms, rounded to whole pixels, as the measured scroll did', async () => {
    const device = fakeAdb([[]]);
    await connectAndroidScreen({ adb: device.adb, clock: fakeClock() }).swipe({ x: 640.4, y: 668.6 }, { x: 640, y: 356 });
    expect(device.calls).toEqual(['shell input swipe 640 669 640 356 400']);
  });

  it('touchesSent lists every tap and drag sent, in order, with when and where, so a failure shows where a touch landed', async () => {
    const device = fakeAdb([[], [GREEN]]);
    const clock = fakeClock();
    const screen = connectAndroidScreen({ adb: device.adb, clock });
    await screen.tapAt({ x: 131.6, y: 367.4 });
    await clock.sleep(250);
    await screen.swipe({ x: 640.4, y: 668.6 }, { x: 640, y: 356 });
    await screen.tapFirstShown(['Green']);
    expect(screen.touchesSent()).toEqual(['0 ms tap at 132,367', '250 ms drag from 640,669 to 640,356', '500 ms tap at 540,970']);
  });

  it('touchesSent answers a copy: what the caller does with it cannot change the record', async () => {
    const screen = connectAndroidScreen({ adb: fakeAdb([[]]).adb, clock: fakeClock() });
    await screen.tapAt({ x: 1, y: 2 });
    screen.touchesSent().push('not sent');
    expect(screen.touchesSent()).toEqual(['0 ms tap at 1,2']);
  });

  it('lists the text typed among the touches sent, with when', async () => {
    // pixel_tablet emulator, run 45037655845: "Ana" arrived as "AAna"; when it was typed was not recorded.
    const device = fakeAdb([[]]);
    const screen = connectAndroidScreen({ adb: device.adb, clock: fakeClock() });
    await screen.typeText('Ana');
    expect(screen.touchesSent()).toEqual(['0 ms type "Ana"']);
  });

  it('lists a note among the touches sent, with when', async () => {
    const device = fakeAdb([[]]);
    const screen = connectAndroidScreen({ adb: device.adb, clock: fakeClock() });
    screen.note('aim at box');
    await screen.tapAt({ x: 1, y: 2 });
    expect(screen.touchesSent()).toEqual(['0 ms aim at box', '0 ms tap at 1,2']);
  });

  it('memoryLog reads what the low-memory killer and the activity manager logged, once, without waiting', async () => {
    // pixel_tablet emulator, run 45027508984: Chrome, the keyboard, Play Store and Wellbeing died within
    // 0.5 s of a Play services update; the crash and event logs cannot say whether memory ran out.
    const device = fakeAdb([[]]);
    await connectAndroidScreen({ adb: device.adb, clock: fakeClock() }).memoryLog();
    expect(device.calls).toEqual(['logcat -d -b main -b system -s lmkd lowmemorykiller ActivityManager -t 2000']);
  });

  it("deviceLog reads the phone's crash and event logs once, without waiting, to show why an app left the screen", async () => {
    const device = fakeAdb([[]]);
    await connectAndroidScreen({ adb: device.adb, clock: fakeClock() }).deviceLog();
    expect(device.calls).toEqual(['logcat -d -b crash -b events -t 2000']);
  });

  it("typeText sends the text through the phone's shell quoted, with spaces as %s", async () => {
    const device = fakeAdb([[]]);
    await connectAndroidScreen({ adb: device.adb, clock: fakeClock() }).typeText("Ana's tea & toast");
    expect(device.calls).toEqual(["shell input text 'Ana'\\''s%stea%s&%stoast'"]);
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

describe('source', () => {
  it('answers the whole uiautomator dump of the screen', async () => {
    const device = fakeAdb([[FILES]]);
    const dump = await connectAndroidScreen({ adb: device.adb, clock: fakeClock() }).source();
    expect(dump).toContain('text="Files"');
    expect(device.calls).toEqual([DUMP_COMMAND.join(' ')]);
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

  it('file: Media picker, where the chooser names its file browser so, then the file', async () => {
    // pixel_9 emulator, round 16 (run 45005023346): the chooser offered Camcorder, Camera and Media picker,
    // no Files; round 17 (run 45007095925) measured Media picker opening the file browser (Recent files).
    const device = fakeAdb([[MEDIA_PICKER], [FILE]]);
    await androidChooseFile(connectAndroidScreen({ adb: device.adb, clock: fakeClock() }), 'device-journey.txt');
    expect(device.taps()).toEqual(['shell input tap 540 1650', 'shell input tap 540 500']);
  });

  it('file: Photos & videos when the chooser names the file browser that way, then the file', async () => {
    // pixel_9 emulator, run 45027508984: once Android's photo picker took file choosing (cdp route), the
    // chooser offered Camera, Camcorder and Photos & videos; Photos & videos opened the same Recent browser.
    const device = fakeAdb([[PHOTOS_AND_VIDEOS], [FILE]]);
    await androidChooseFile(connectAndroidScreen({ adb: device.adb, clock: fakeClock() }), 'device-journey.txt');
    expect(device.taps()).toEqual(['shell input tap 540 1850', 'shell input tap 540 500']);
  });

  it("file: answers a fresh phone's camera prompt While using the app, then Files, then the file", async () => {
    // pixel_9 emulator, run 44993134413: Chrome asked to take pictures before its chooser showed. Run
    // 44995686112 answered Only this time, and Chrome was gone behind the chooser: Android withdraws a
    // one-time permission, ending the app, once it leaves the screen.
    const device = fakeAdb([[WHILE_USING], [FILES], [FILE]]);
    await androidChooseFile(connectAndroidScreen({ adb: device.adb, clock: fakeClock() }), 'device-journey.txt');
    expect(device.taps()).toEqual(['shell input tap 540 1250', 'shell input tap 100 2050', 'shell input tap 540 500']);
  });

  it('photo: the newest photo, then Done', async () => {
    const device = fakeAdb([[PHOTO], [PHOTO], [DONE]]);
    await androidChoosePhoto(connectAndroidScreen({ adb: device.adb, clock: fakeClock() }));
    expect(device.taps()).toEqual(['shell input tap 250 650', 'shell input tap 900 2250']);
  });

  it('photo: waits for the photo to stop moving before touching it', async () => {
    // pixel_9 emulator, run 45035234085: the tap went to 179,1063 as the picker's sheet opened; a banner
    // ("Chrome will only have access to the photos you select") then pushed the photo to 1232-1590.
    const moving: Node = { ...PHOTO, bounds: [100, 900, 400, 1200] };
    const device = fakeAdb([[PHOTO], [moving], [moving], [DONE]]);
    await androidChoosePhoto(connectAndroidScreen({ adb: device.adb, clock: fakeClock() }));
    expect(device.taps()).toEqual(['shell input tap 250 1050', 'shell input tap 900 2250']);
  });

  it('photo: the newest photo alone when the picker closes on the tap, with no Done to wait for', async () => {
    // pixel_9 emulator, run 45027508984: the page had 18.png, the picker was gone, and waiting for Done failed.
    const device = fakeAdb([[PHOTO], [PHOTO], []]);
    await androidChoosePhoto(connectAndroidScreen({ adb: device.adb, clock: fakeClock() }));
    expect(device.taps()).toEqual(['shell input tap 250 650']);
    // Two looks agree where the photo is, and one finds the picker gone: no wait for Done.
    expect(device.calls.filter((call) => call.startsWith('exec-out uiautomator'))).toHaveLength(3);
  });

  it('photo: waits while the picker is still open without Done, then Done', async () => {
    const device = fakeAdb([[PHOTO], [PHOTO], [PHOTO, DONE]]);
    await androidChoosePhoto(connectAndroidScreen({ adb: device.adb, clock: fakeClock() }));
    expect(device.taps()).toEqual(['shell input tap 250 650', 'shell input tap 900 2250']);
  });

  it('photo: fails at the ceiling naming Done when the picker stays open and Done never shows', async () => {
    const device = fakeAdb([[PHOTO]]);
    // One poll goes on seeing the photo hold still before the 60 s wait for Done starts.
    const clock = fakeClock(LONGEST_CEILING_MS + 1_000);
    await expect(androidChoosePhoto(connectAndroidScreen({ adb: device.adb, clock }))).rejects.toThrow(
      'the photo picker neither closed nor showed "Done" within 60000 ms',
    );
    expect(device.taps()).toEqual(['shell input tap 250 650']);
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
