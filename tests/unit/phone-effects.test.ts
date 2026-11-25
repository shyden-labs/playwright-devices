import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFile = vi.fn();
vi.mock('node:child_process', () => ({ execFile }));
const webkit = { connectOverCDP: vi.fn(() => Promise.resolve('safari')) };
const chromium = { connectOverCDP: vi.fn(() => Promise.resolve('chrome')) };
const android = { devices: vi.fn(() => Promise.resolve(['phone'])) };
vi.mock('@playwright/test', () => ({ webkit, chromium, _android: android }));
const connectWda = vi.fn(() => Promise.resolve('wda'));
vi.mock('../../src/devices/wda-client.ts', () => ({ connectWda }));
const chromeStart = {
  startChromeCold: vi.fn(() => Promise.resolve('started')),
  requireChromeDebugApp: vi.fn(() => Promise.resolve()),
  stopChromeAfterPlaywright: vi.fn(() => Promise.resolve()),
};
vi.mock('../../src/devices/android-chrome-start.ts', () => chromeStart);

const { REAL_EFFECTS } = await import('../../src/devices/phone-effects.ts');

type Callback = (error: (Error & { killed?: boolean }) | null, stdout: string, stderr: string) => void;

/** execFile answering the next call with `error`, `stdout` and `stderr`. */
function answerNext(error: (Error & { killed?: boolean }) | null, stdout = '', stderr = '') {
  execFile.mockImplementationOnce((_file: string, _args: string[], _options: object, callback: Callback) => {
    callback(error, stdout, stderr);
  });
}

beforeEach(() => {
  execFile.mockReset();
});

describe('REAL_EFFECTS', () => {
  it("connects Safari and Chrome over CDP through Playwright, and lists Playwright's Android devices", async () => {
    expect(await REAL_EFFECTS.webkitOverCDP('http://127.0.0.1:9222')).toBe('safari');
    expect(webkit.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9222');
    expect(await REAL_EFFECTS.chromiumOverCDP('http://127.0.0.1:9230')).toBe('chrome');
    expect(chromium.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9230');
    expect(await REAL_EFFECTS.androidDevices()).toEqual(['phone']);
  });

  it('connects WebDriverAgent at the URL given', async () => {
    expect(await REAL_EFFECTS.connectWda('http://127.0.0.1:8100')).toBe('wda');
    expect(connectWda).toHaveBeenCalledWith({ url: 'http://127.0.0.1:8100' });
  });

  it('runs adb against the one serial, with a 30 s ceiling, answering its output', async () => {
    answerNext(null, 'Physical size: 1080x2400\n');
    expect(await REAL_EFFECTS.adbFor('S')(['shell', 'wm', 'size'])).toBe('Physical size: 1080x2400\n');
    expect(execFile).toHaveBeenCalledWith(
      'adb',
      ['-s', 'S', 'shell', 'wm', 'size'],
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    );
  });

  it('fails naming the adb call and its stderr', async () => {
    answerNext(new Error('exit 1'), '', 'device offline');
    await expect(REAL_EFFECTS.adbFor('S')(['shell', 'wm', 'size'])).rejects.toThrow('adb shell wm size failed: device offline');
  });

  it('says when adb was stopped at its ceiling, falling back to the error when stderr is empty', async () => {
    answerNext(Object.assign(new Error('killed'), { killed: true }));
    await expect(REAL_EFFECTS.adbFor('S')(['exec-out', 'uiautomator', 'dump'])).rejects.toThrow(
      'adb exec-out uiautomator dump failed after 30000 ms: killed',
    );
  });

  it("copies a file into the WebDriverAgent runner's Documents with devicectl", async () => {
    answerNext(null);
    await REAL_EFFECTS.copyToIphone('U', 'org.example.WebDriverAgentRunner.xctrunner', '/project/files/brief.txt');
    expect(execFile).toHaveBeenCalledWith(
      'xcrun',
      [
        'devicectl',
        'device',
        'copy',
        'to',
        '--device',
        'U',
        '--domain-type',
        'appDataContainer',
        '--domain-identifier',
        'org.example.WebDriverAgentRunner.xctrunner',
        '--source',
        '/project/files/brief.txt',
        '--destination',
        'Documents/brief.txt',
      ],
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    );
  });

  it('fails naming the file and devicectl’s stderr when the copy fails', async () => {
    answerNext(new Error('exit 1'), '', 'The device is locked.');
    await expect(REAL_EFFECTS.copyToIphone('U', 'r', '/project/files/brief.txt')).rejects.toThrow(
      'could not put /project/files/brief.txt on the iPhone U: The device is locked.',
    );
  });

  it('starts, checks and stops Chrome through the Chrome-start helpers', async () => {
    const adb = vi.fn();
    expect(await REAL_EFFECTS.startChrome(adb, 9230)).toBe('started');
    expect(chromeStart.startChromeCold).toHaveBeenCalledWith({ adb, port: 9230 });
    await REAL_EFFECTS.requireChromeDebugApp(adb);
    expect(chromeStart.requireChromeDebugApp).toHaveBeenCalledWith(adb);
    await REAL_EFFECTS.stopChromeAfterPlaywright(adb);
    expect(chromeStart.stopChromeAfterPlaywright).toHaveBeenCalledWith(adb);
  });
});
