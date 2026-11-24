import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { androidSession, iosSession, routeFrom, withNamedSteps } from '../../research/devices/device-session.ts';
import { PHOTO_GRID_IMAGE } from '../../research/devices/ios-native.ts';

/** A WebDriverAgent stand-in recording each step; `shown` is what the screen lists. */
function fakeWda(shown: string[] = []) {
  const steps: string[] = [];
  return {
    steps,
    tapFirstShown: (labels: string[]) => {
      const hit = labels.find((label) => shown.includes(label)) ?? labels[0] ?? '';
      steps.push(`tap ${hit}`);
      return Promise.resolve(hit);
    },
    tapIfShown: (labels: string[]) => {
      const hit = labels.find((label) => shown.includes(label));
      steps.push(hit === undefined ? `look for ${labels.join(', ')}` : `tap ${hit}`);
      return Promise.resolve(hit);
    },
    waitGone: (predicate: string) => {
      steps.push(`wait until gone: ${predicate}`);
      return Promise.resolve();
    },
    tapCellIcon: (name: string) => {
      steps.push(`tap the icon of ${name}`);
      return Promise.resolve();
    },
    tapTopLeftOf: (predicate: string) => {
      steps.push(`tap top-left of ${predicate}`);
      return Promise.resolve();
    },
    tapAt: () => Promise.resolve(),
    typeText: () => Promise.resolve(),
    rectOf: () => Promise.resolve({ x: 0, y: 0, width: 100, height: 100 }),
    windowSize: () => Promise.resolve({ width: 400, height: 800 }),
    swipe: (from: { x: number; y: number }, to: { x: number; y: number }) => {
      steps.push(`swipe ${from.x},${from.y} -> ${to.x},${to.y}`);
      return Promise.resolve();
    },
    screenshot: () => Promise.resolve(Buffer.from('ios screen')),
    source: () => Promise.resolve('<ios screen/>'),
    close: () => {
      steps.push('close');
      return Promise.resolve();
    },
  };
}

const page = {} as Page;
const file = { folder: 'WebDriverAgentRunner-Runner', label: 'device-journey' };

describe('iosSession', () => {
  it('routes each native step through WebDriverAgent', async () => {
    const wda = fakeWda(['Choose File', 'Browse', 'On My iPhone']);
    const session = iosSession({ page, wda, baseURL: 'http://mac.local:4321', file });

    await session.nativeChoose('Green');
    await session.nativeChooseFile();
    await session.nativeChoosePhoto();
    await session.fingerScroll();

    expect(wda.steps).toEqual([
      'tap Green',
      'tap Choose File',
      'tap Browse',
      'tap On My iPhone',
      `tap the icon of ${file.folder}`,
      `tap the icon of ${file.label}`,
      `wait until gone: type == 'XCUIElementTypeCell' AND label BEGINSWITH '${file.label}, '`,
      'tap Photo Library',
      `tap top-left of ${PHOTO_GRID_IMAGE}`,
      'tap Done',
      `wait until gone: ${PHOTO_GRID_IMAGE}`,
      'swipe 200,360 -> 200,120',
    ]);
  });

  it('close shuts a picker left open, then ends the WebDriverAgent session', async () => {
    const wda = fakeWda(['Cancel']);
    await iosSession({ page, wda, baseURL: 'http://mac.local:4321', file }).close();
    expect(wda.steps).toEqual(['tap Cancel', 'look for Done', 'close']);
  });

  it('close ends the WebDriverAgent session even when closing the picker fails, and reports that failure', async () => {
    const wda = fakeWda();
    wda.tapIfShown = () => Promise.reject(new Error('WebDriverAgent went away'));
    await expect(iosSession({ page, wda, baseURL: 'http://mac.local:4321', file }).close()).rejects.toThrow('WebDriverAgent went away');
    expect(wda.steps).toEqual(['close']);
  });

  it('screenshots the device through WebDriverAgent', async () => {
    const session = iosSession({ page, wda: fakeWda(), baseURL: 'http://mac.local:4321', file });
    expect(await session.screenshot()).toEqual(Buffer.from('ios screen'));
  });

  it("describes the device's screen through WebDriverAgent, for a failure's evidence", async () => {
    const session = iosSession({ page, wda: fakeWda(), baseURL: 'http://mac.local:4321', file });
    expect(await session.screenSource()).toBe('<ios screen/>');
  });

  it('answers no further failure evidence: WebDriverAgent keeps its own log', async () => {
    const session = iosSession({ page, wda: fakeWda(), baseURL: 'http://mac.local:4321', file });
    expect(await session.moreEvidence()).toEqual([]);
  });

  it('gives the test a page stand-in, not the real page', () => {
    const session = iosSession({ page, wda: fakeWda(), baseURL: 'http://mac.local:4321', file });
    expect(session.page).not.toBe(page);
  });
});

/** An adb stand-in: the screen lists `shown`, the size is 1080x2400; every call is recorded. */
function fakeAdb(shown: string[] = []) {
  const calls: string[] = [];
  const adb = (args: string[]) => {
    const call = args.join(' ');
    calls.push(call);
    if (call.startsWith('exec-out uiautomator dump')) {
      // A photo in Google's picker has no text, only a description such as "Photo taken on …".
      const nodes = shown.map((text, i) => {
        const [label, description] = text.startsWith('Photo taken on') ? ['', text] : [text, ''];
        return `<node text="${label}" content-desc="${description}" bounds="[0,${i * 100}][100,${i * 100 + 100}]" />`;
      });
      return Promise.resolve(`<hierarchy>${nodes.join('')}</hierarchy>`);
    }
    if (call === 'shell wm size') return Promise.resolve('Physical size: 1080x2400\n');
    if (call.startsWith('logcat -d')) return Promise.resolve('am_crash: com.android.chrome\n');
    if (call === 'exec-out screencap -p | base64') return Promise.resolve(Buffer.from('android screen').toString('base64'));
    return Promise.resolve('');
  };
  return { adb, calls, kept: () => calls.filter((c) => !c.startsWith('exec-out uiautomator dump')) };
}

const files = { document: '/repo/fixtures/device-journey.txt', photo: '/repo/fixtures/device-journey.png' };
const BROADCAST = 'shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://';

describe('androidSession', () => {
  it('stages the document in Downloads and the photo in Pictures before the test, so the pickers list them', async () => {
    const device = fakeAdb();
    await androidSession({ page, adb: device.adb, baseURL: 'http://127.0.0.1:4321', files });
    expect(device.kept()).toEqual([
      'push /repo/fixtures/device-journey.txt /sdcard/Download/device-journey.txt',
      'shell touch /sdcard/Download/device-journey.txt',
      `${BROADCAST}/sdcard/Download/device-journey.txt`,
      'push /repo/fixtures/device-journey.png /sdcard/Pictures/device-journey.png',
      'shell touch /sdcard/Pictures/device-journey.png',
      `${BROADCAST}/sdcard/Pictures/device-journey.png`,
    ]);
  });

  it('routes each native step through uiautomator and adb input', async () => {
    const device = fakeAdb(['Green', 'Files', 'device-journey.txt']);
    const session = await androidSession({ page, adb: device.adb, baseURL: 'http://127.0.0.1:4321', files });
    const before = device.kept().length;

    await session.nativeChoose('Green');
    await session.nativeChooseFile();
    await session.fingerScroll();

    expect(device.kept().slice(before)).toEqual([
      'shell input tap 50 50',
      'shell input tap 50 150',
      'shell input tap 50 250',
      'shell wm size',
      'shell input swipe 540 1080 540 360 400',
    ]);
  });

  it("chooses the photo by touching the picker's first photo, then Done", async () => {
    const device = fakeAdb(['Photo taken on 22 Nov 2026', 'Done']);
    const session = await androidSession({ page, adb: device.adb, baseURL: 'http://127.0.0.1:4321', files });
    const before = device.kept().length;

    await session.nativeChoosePhoto();

    expect(device.kept().slice(before)).toEqual(['shell input tap 50 50', 'shell input tap 50 150']);
  });

  it("gives the test a page stand-in, so taps and keys go through Android's own input", async () => {
    const session = await androidSession({ page, adb: fakeAdb().adb, baseURL: 'http://127.0.0.1:4321', files });
    expect(session.page).not.toBe(page);
  });

  it('screenshots the phone through adb', async () => {
    const session = await androidSession({ page, adb: fakeAdb().adb, baseURL: 'http://127.0.0.1:4321', files });
    expect(await session.screenshot()).toEqual(Buffer.from('android screen'));
  });

  it("answers the touches it sent and the phone's crash and event logs, for a failure's evidence", async () => {
    const session = await androidSession({ page, adb: fakeAdb(['Green']).adb, baseURL: 'http://127.0.0.1:4321', files });
    await session.nativeChoose('Green');
    expect(await session.moreEvidence()).toEqual([
      { name: 'touches sent', body: expect.stringMatching(/^\d+ ms tap at 50,50$/) as unknown },
      { name: 'device log', body: 'am_crash: com.android.chrome\n' },
      { name: 'memory killer log', body: 'am_crash: com.android.chrome\n' },
    ]);
  });

  it("describes the phone's screen with a uiautomator dump, for a failure's evidence", async () => {
    const session = await androidSession({ page, adb: fakeAdb(['Green']).adb, baseURL: 'http://127.0.0.1:4321', files });
    expect(await session.screenSource()).toContain('text="Green"');
  });

  it('close shuts a picker left open, then removes both staged files', async () => {
    const device = fakeAdb(['Done']);
    const session = await androidSession({ page, adb: device.adb, baseURL: 'http://127.0.0.1:4321', files });
    const before = device.kept().length;

    await session.close();

    expect(device.kept().slice(before)).toEqual([
      'shell input tap 50 50',
      'shell rm -f /sdcard/Download/device-journey.txt',
      `${BROADCAST}/sdcard/Download/device-journey.txt`,
      'shell rm -f /sdcard/Pictures/device-journey.png',
      `${BROADCAST}/sdcard/Pictures/device-journey.png`,
    ]);
  });

  it('close removes the staged files even when closing the picker fails, and reports that failure', async () => {
    const device = fakeAdb();
    let screenReadable = true;
    const adb = (args: string[]) =>
      !screenReadable && args[1] === 'uiautomator' ? Promise.reject(new Error('device offline')) : device.adb(args);
    const session = await androidSession({ page, adb, baseURL: 'http://127.0.0.1:4321', files });
    screenReadable = false;

    await expect(session.close()).rejects.toThrow('device offline');
    expect(device.calls.filter((c) => c.startsWith('shell rm -f'))).toHaveLength(2);
  });
});

describe('routeFrom', () => {
  it.each(['ios-webkit', 'android-cdp', 'android-playwright'])('accepts DEVICE_ROUTE=%s', (route) => {
    expect(routeFrom({ DEVICE_ROUTE: route })).toBe(route);
  });

  it('refuses a missing or unknown route, naming the three it knows', () => {
    const known = 'DEVICE_ROUTE must be one of ios-webkit, android-cdp, android-playwright';
    expect(() => routeFrom({})).toThrow(`${known}; it is unset`);
    expect(() => routeFrom({ DEVICE_ROUTE: 'ios' })).toThrow(`${known}; it is "ios"`);
  });
});

describe('withNamedSteps', () => {
  it("runs each native step inside a step named for it, so a slow stage's report shows which native step took the time", async () => {
    const wda = fakeWda(['Choose File', 'Browse', 'On My iPhone']);
    const named: string[] = [];
    const session = withNamedSteps(iosSession({ page, wda, baseURL: 'http://mac.local:4321', file }), async (name, body) => {
      named.push(`start ${name}`);
      await body();
      named.push(`end ${name}`);
    });

    await session.nativeChoose('Green');
    await session.nativeChooseFile();
    await session.nativeChoosePhoto();
    await session.fingerScroll();

    expect(named).toEqual([
      'start native: choose "Green"',
      'end native: choose "Green"',
      'start native: choose a file',
      'end native: choose a file',
      'start native: choose a photo',
      'end native: choose a photo',
      'start native: finger scroll',
      'end native: finger scroll',
    ]);
    expect(wda.steps).toHaveLength(12);
  });

  it('keeps the page, screenshot and close as they are', () => {
    const wda = fakeWda();
    const session = iosSession({ page, wda, baseURL: 'http://mac.local:4321', file });
    const stepped = withNamedSteps(session, (_name, body) => body());
    expect(stepped.page).toBe(session.page);
    expect(stepped.screenshot).toBe(session.screenshot);
    expect(stepped.close).toBe(session.close);
  });
});
