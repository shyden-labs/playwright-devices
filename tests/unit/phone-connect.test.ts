import type { Browser, BrowserContext, Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import type { Adb } from '../../src/devices/finger-scroll.ts';
import { connectPhone, type ConnectEffects } from '../../src/devices/phone-connect.ts';
import type { IosDevice } from '../../src/devices/device-session.ts';

const files = { document: '/project/files/brief.txt', photo: '/project/files/photo.png' };
const BASE = 'http://192.168.1.3:4173';

/** An adb stand-in answering what an Android session asks for at the start. */
function fakeAdb(calls: string[]): Adb {
  return (args) => {
    calls.push(`adb ${args.join(' ')}`);
    return Promise.resolve(args.join(' ') === 'shell wm size' ? 'Physical size: 1080x2400\n' : '');
  };
}

function fakePage(close = vi.fn(() => Promise.resolve())): Page {
  return { close } as unknown as Page;
}

/** Every effect recorded in order; each answers what a working phone would. */
function fakeEffects(calls: string[], over: Partial<ConnectEffects> = {}) {
  const tab = fakePage();
  const closes = {
    page: vi.fn(() => Promise.resolve()),
    safari: vi.fn(() => Promise.resolve()),
    chrome: vi.fn(() => {
      calls.push('chrome browser close');
      return Promise.resolve();
    }),
    context: vi.fn(() => Promise.resolve()),
    device: vi.fn(() => Promise.resolve()),
  };
  const newPage = fakePage(closes.page);
  const safari = { contexts: () => [{ pages: () => [tab] }], close: closes.safari } as unknown as Browser;
  const chrome = { contexts: () => [{ newPage: () => Promise.resolve(newPage) }], close: closes.chrome } as unknown as Browser;
  const context = { newPage: () => Promise.resolve(newPage), close: closes.context } as unknown as BrowserContext;
  const device = { serial: () => 'S', launchBrowser: () => Promise.resolve(context), close: closes.device };
  const effects: ConnectEffects = {
    webkitOverCDP: (url) => {
      calls.push(`webkit ${url}`);
      return Promise.resolve(safari);
    },
    chromiumOverCDP: (url) => {
      calls.push(`chromium ${url}`);
      return Promise.resolve(chrome);
    },
    androidDevices: () => Promise.resolve([device]),
    connectWda: (url) => {
      calls.push(`wda ${url}`);
      return Promise.resolve({} as IosDevice);
    },
    adbFor: (serial) => {
      calls.push(`adbFor ${serial}`);
      return fakeAdb(calls);
    },
    copyToIphone: (udid, runnerId, file) => {
      calls.push(`copy ${file} to ${udid} ${runnerId}`);
      return Promise.resolve();
    },
    copyToSimulator: (udid, runnerId, file) => {
      calls.push(`copy ${file} to simulator ${udid} ${runnerId}`);
      return Promise.resolve();
    },
    startChrome: (_adb, port) => {
      calls.push(`start chrome on ${port}`);
      return Promise.resolve({
        stop: () => {
          calls.push('stop chrome');
          return Promise.resolve();
        },
      });
    },
    requireChromeDebugApp: () => {
      calls.push('check debug app');
      return Promise.resolve();
    },
    stopChromeAfterPlaywright: () => {
      calls.push('stop chrome after playwright');
      return Promise.resolve();
    },
    ...over,
  };
  return { effects, closes };
}

describe('connectPhone on the iPhone', () => {
  const env = { PLAYWRIGHT_DEVICES_TARGET: 'iphone', IOS_UDID: 'U', IOS_RUNNER_ID: 'org.example.WebDriverAgentRunner.xctrunner' };

  it('puts the document on the phone, then connects Safari and WebDriverAgent at their default addresses', async () => {
    const calls: string[] = [];
    const { effects, closes } = fakeEffects(calls);

    const connection = await connectPhone('iphone', env, BASE, files, effects);

    expect(calls).toEqual([
      'copy /project/files/brief.txt to U org.example.WebDriverAgentRunner.xctrunner',
      'webkit http://127.0.0.1:9222',
      'wda http://127.0.0.1:8100',
    ]);
    await connection.disconnect();
    expect(closes.safari).toHaveBeenCalledOnce();
  });

  it('uses the addresses and the Files folder the environment names', async () => {
    const calls: string[] = [];
    const { effects } = fakeEffects(calls);
    await connectPhone('iphone', { ...env, IWDP_URL: 'http://127.0.0.1:9300', WDA_URL: 'http://127.0.0.1:8101' }, BASE, files, effects);
    expect(calls.slice(1)).toEqual(['webkit http://127.0.0.1:9300', 'wda http://127.0.0.1:8101']);
  });

  it('refuses Safari with more than one tab, naming the count, and lets go of Safari', async () => {
    const calls: string[] = [];
    const closeTwoTabs = vi.fn(() => Promise.resolve());
    const twoTabs = { contexts: () => [{ pages: () => [fakePage(), fakePage()] }], close: closeTwoTabs } as unknown as Browser;
    const { effects } = fakeEffects(calls, { webkitOverCDP: () => Promise.resolve(twoTabs) });

    await expect(connectPhone('iphone', env, BASE, files, effects)).rejects.toThrow('Safari must have exactly one tab open; it has 2');
    expect(closeTwoTabs).toHaveBeenCalledOnce();
  });

  it("puts the document into a simulator's runner, not through devicectl, when IOS_SIMULATOR is 1", async () => {
    const calls: string[] = [];
    const { effects } = fakeEffects(calls);
    await connectPhone('iphone', { ...env, IOS_SIMULATOR: '1' }, BASE, files, effects);
    expect(calls[0]).toBe('copy /project/files/brief.txt to simulator U org.example.WebDriverAgentRunner.xctrunner');
  });

  it('fails naming IOS_UDID when the run did not set it', async () => {
    const { effects } = fakeEffects([]);
    await expect(connectPhone('iphone', { PLAYWRIGHT_DEVICES_TARGET: 'iphone' }, BASE, files, effects)).rejects.toThrow(
      'IOS_UDID is not set; `playwright-devices start iphone` sets it',
    );
  });

  it('fails naming IOS_RUNNER_ID when the run did not set it', async () => {
    const { effects } = fakeEffects([]);
    await expect(connectPhone('iphone', { PLAYWRIGHT_DEVICES_TARGET: 'iphone', IOS_UDID: 'U' }, BASE, files, effects)).rejects.toThrow(
      'IOS_RUNNER_ID is not set; `playwright-devices start iphone` sets it',
    );
  });
});

describe('connectPhone refuses a run started for another device', () => {
  it('names both when the project needs the iPhone and the run was started for Android', async () => {
    const calls: string[] = [];
    const { effects } = fakeEffects(calls);
    await expect(connectPhone('iphone', { PLAYWRIGHT_DEVICES_TARGET: 'android' }, BASE, files, effects)).rejects.toThrow(
      'project iphone needs `playwright-devices start iphone`; this run was started for android',
    );
    expect(calls).toEqual([]);
  });

  it('says so when no start command started the run', async () => {
    const calls: string[] = [];
    const { effects } = fakeEffects(calls);
    await expect(connectPhone('android-cdp', {}, BASE, files, effects)).rejects.toThrow(
      'project android-cdp needs `playwright-devices start android`; this run was not started by it',
    );
    expect(calls).toEqual([]);
  });

  it('refuses a project that is not a phone project', async () => {
    const { effects } = fakeEffects([]);
    await expect(connectPhone('chromium', { PLAYWRIGHT_DEVICES_TARGET: 'android' }, BASE, files, effects)).rejects.toThrow(
      'not a phone project: chromium',
    );
  });
});

describe('connectPhone on Android over CDP', () => {
  const env = { PLAYWRIGHT_DEVICES_TARGET: 'android', ANDROID_SERIAL: 'S' };

  it('starts Chrome cold on the default port, connects over CDP and opens a new page', async () => {
    const calls: string[] = [];
    const { effects } = fakeEffects(calls);
    await connectPhone('android-cdp', env, BASE, files, effects);
    expect(calls.slice(0, 3)).toEqual(['adbFor S', 'start chrome on 9230', 'chromium http://127.0.0.1:9230']);
  });

  it('uses the CDP port the environment names', async () => {
    const calls: string[] = [];
    const { effects } = fakeEffects(calls);
    await connectPhone('android-cdp', { ...env, ANDROID_CDP_PORT: '9240' }, BASE, files, effects);
    expect(calls.slice(1, 3)).toEqual(['start chrome on 9240', 'chromium http://127.0.0.1:9240']);
  });

  it('disconnects page, then browser, then stops Chrome, and stops Chrome even when the browser will not close', async () => {
    const calls: string[] = [];
    const { effects, closes } = fakeEffects(calls);
    const connection = await connectPhone('android-cdp', env, BASE, files, effects);
    closes.chrome.mockImplementationOnce(() => Promise.reject(new Error('gone')));

    await expect(connection.disconnect()).rejects.toThrow('gone');
    expect(closes.page).toHaveBeenCalledOnce();
    expect(calls.at(-1)).toBe('stop chrome');
  });

  it('refuses when Chrome offers no browser context', async () => {
    const { effects } = fakeEffects([], { chromiumOverCDP: () => Promise.resolve({ contexts: () => [] } as unknown as Browser) });
    await expect(connectPhone('android-cdp', env, BASE, files, effects)).rejects.toThrow('Chrome on the phone offered no browser context');
  });

  it('fails naming ANDROID_SERIAL when the run did not set it', async () => {
    const { effects } = fakeEffects([]);
    await expect(connectPhone('android-cdp', { PLAYWRIGHT_DEVICES_TARGET: 'android' }, BASE, files, effects)).rejects.toThrow(
      'ANDROID_SERIAL is not set; `playwright-devices start android` sets it',
    );
  });
});

describe("connectPhone on Android through Playwright's own support", () => {
  const env = { PLAYWRIGHT_DEVICES_TARGET: 'android', ANDROID_SERIAL: 'S' };

  it('checks the debug app, launches Chrome on the listed device, and on disconnect closes it and stops Chrome', async () => {
    const calls: string[] = [];
    const { effects, closes } = fakeEffects(calls);
    const connection = await connectPhone('android-playwright', env, BASE, files, effects);
    expect(calls.slice(0, 2)).toEqual(['adbFor S', 'check debug app']);

    await connection.disconnect();
    expect(closes.context).toHaveBeenCalledOnce();
    expect(closes.device).toHaveBeenCalledOnce();
    expect(calls.at(-1)).toBe('stop chrome after playwright');
  });

  it('fails naming the serial when Playwright does not list the device', async () => {
    const { effects } = fakeEffects([], { androidDevices: () => Promise.resolve([]) });
    await expect(connectPhone('android-playwright', { ...env, ANDROID_SERIAL: 'X' }, BASE, files, effects)).rejects.toThrow(
      'Playwright lists no Android device X',
    );
  });

  it('stages the project’s own files for the pickers', async () => {
    const calls: string[] = [];
    const { effects } = fakeEffects(calls);
    await connectPhone('android-playwright', env, BASE, files, effects);
    expect(calls).toContain('adb push /project/files/brief.txt /sdcard/Download/brief.txt');
    expect(calls).toContain('adb push /project/files/photo.png /sdcard/Pictures/photo.png');
  });
});
