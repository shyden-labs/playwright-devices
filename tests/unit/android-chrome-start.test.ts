import { describe, expect, it } from 'vitest';
import { requireChromeDebugApp, startChromeCold, stopChromeAfterPlaywright } from '../../src/devices/android-chrome-start.ts';

/**
 * An adb stand-in recording each call; `answers` gives the output for a call by its joined arguments, and
 * `failures` the error a call rejects with, as the real adb does when the phone's command exits non-zero.
 */
function fakeAdb(answers: Record<string, string> = {}, failures: Record<string, string> = {}) {
  const calls: string[] = [];
  const adb = (args: string[]) => {
    const call = args.join(' ');
    calls.push(call);
    if (call in failures) return Promise.reject(new Error(failures[call]));
    return Promise.resolve(answers[call] ?? '');
  };
  return { adb, calls };
}

/** A clock that moves only when the code under test sleeps. */
function fakeClock() {
  let now = 0;
  return { now: () => now, sleep: (ms: number) => ((now += ms), Promise.resolve()) };
}

/** Answers each /json/version request with the next of `replies` (the last repeats); an Error is thrown as a refused connection. */
function fakeFetch(replies: (string | Error)[]) {
  const urls: string[] = [];
  let index = 0;
  const fetchFn = (url: string | URL | Request) => {
    urls.push(url instanceof Request ? url.url : url.toString());
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(new Response(reply ?? ''));
  };
  return { fetchFn, urls };
}

const VERSION = JSON.stringify({ Browser: 'Chrome/157.0.8103.50' });

describe('startChromeCold', () => {
  it('stops Chrome, replaces any leftover command-line file with first-run flags only, starts Chrome and forwards its socket, in that order', async () => {
    const { adb, calls } = fakeAdb();
    const { fetchFn } = fakeFetch([VERSION]);

    await startChromeCold({ adb, fetchFn, clock: fakeClock(), port: 9230 });

    expect(calls).toEqual([
      'shell am force-stop com.android.chrome',
      // Playwright's own first-run flags, and no socket name, so the socket stays chrome_devtools_remote
      // (shyden-labs/playwright-devices#47: a fresh emulator's Chrome sat on its first-run screen).
      'shell echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line',
      'shell am start -n com.android.chrome/com.google.android.apps.chrome.Main -d http://127.0.0.1:9/',
      'forward tcp:9230 localabstract:chrome_devtools_remote',
    ]);
  });

  it("waits until Chrome's DevTools endpoint names the browser, and answers how long that took", async () => {
    const { adb } = fakeAdb();
    const { fetchFn, urls } = fakeFetch([new Error('ECONNREFUSED'), '', VERSION]);

    const started = await startChromeCold({ adb, fetchFn, clock: fakeClock(), port: 9230 });

    expect(urls).toEqual([
      'http://127.0.0.1:9230/json/version',
      'http://127.0.0.1:9230/json/version',
      'http://127.0.0.1:9230/json/version',
    ]);
    expect(started.readyAfterMs).toBe(500);
  });

  it('fails at its ceiling naming the endpoint and what it last answered, with nothing retried after', async () => {
    const { adb, calls } = fakeAdb();
    const { fetchFn } = fakeFetch([new Error('ECONNREFUSED')]);

    await expect(startChromeCold({ adb, fetchFn, clock: fakeClock(), port: 9230, ceilingMs: 2_000 })).rejects.toThrow(
      "Chrome's DevTools endpoint http://127.0.0.1:9230/json/version did not name a browser within 2000 ms; it last answered: ECONNREFUSED.",
    );
    expect(calls.filter((call) => call.startsWith('shell am start'))).toHaveLength(1);
  });

  it('names what the phone showed when the endpoint never named the browser: sockets, Chrome, command line, screen', async () => {
    // pixel_tablet emulator, run 45067365988: the cdp route's endpoint answered UND_ERR_SOCKET for 30 s twice,
    // with no Play update, and nothing said whether Chrome ran or under which socket name.
    const { adb } = fakeAdb({
      'shell grep -a devtools /proc/net/unix': '00000000: 00000002 0 10000 0001 01 12345 @webview_devtools_remote_4242',
      'shell pidof com.android.chrome': '4242',
      'shell ls /data/local/tmp/chrome-command-line': 'ls: /data/local/tmp/chrome-command-line: No such file or directory',
      'shell dumpsys activity activities': 'junk\n  topResumedActivity=ActivityRecord{1 u0 com.android.chrome/.Main t9}\nmore',
    });
    const { fetchFn } = fakeFetch([new Error('UND_ERR_SOCKET')]);

    const failure = startChromeCold({ adb, fetchFn, clock: fakeClock(), port: 9230, ceilingMs: 2_000 });

    await expect(failure).rejects.toThrow(
      [
        "Chrome's DevTools endpoint http://127.0.0.1:9230/json/version did not name a browser within 2000 ms; it last answered: UND_ERR_SOCKET.",
        'The phone showed: devtools sockets: @webview_devtools_remote_4242; Chrome pid: 4242;',
        'command line file: ls: /data/local/tmp/chrome-command-line: No such file or directory;',
        'on screen: topResumedActivity=ActivityRecord{1 u0 com.android.chrome/.Main t9}',
      ].join(' '),
    );
  });

  it('still names what the phone showed when its look-ups exit non-zero, as pidof, grep and ls do when nothing is there', async () => {
    // pixel_tablet emulator, run 45353878042: no command-line file made `adb shell ls` exit 1, the real adb
    // rejected, and that rejection replaced the endpoint's failure, so nothing said what the phone showed.
    const { adb } = fakeAdb(
      { 'shell dumpsys activity activities': '  topResumedActivity=ActivityRecord{1 u0 com.android.chrome/.Main t9}' },
      {
        'shell grep -a devtools /proc/net/unix': 'adb shell grep -a devtools /proc/net/unix failed: ',
        'shell pidof com.android.chrome': 'adb shell pidof com.android.chrome failed: ',
        'shell ls /data/local/tmp/chrome-command-line':
          'adb shell ls /data/local/tmp/chrome-command-line failed: ls: /data/local/tmp/chrome-command-line: No such file or directory',
      },
    );
    const { fetchFn } = fakeFetch([new Error('UND_ERR_SOCKET')]);

    const failure = startChromeCold({ adb, fetchFn, clock: fakeClock(), port: 9230, ceilingMs: 2_000 });

    await expect(failure).rejects.toThrow(
      [
        "Chrome's DevTools endpoint http://127.0.0.1:9230/json/version did not name a browser within 2000 ms; it last answered: UND_ERR_SOCKET.",
        'The phone showed: devtools sockets: none; Chrome pid: none; command line file: none;',
        'on screen: topResumedActivity=ActivityRecord{1 u0 com.android.chrome/.Main t9}',
      ].join(' '),
    );
  });

  it('fails at once when Chrome shows its first-run screen, which opens no DevTools socket, naming it and the fix', async () => {
    // Measured in CI 2026-11-26 (run 45727815519, pixel_9): every CDP start in the round sat on this screen
    // and answered UND_ERR_SOCKET for the whole 30 s (shyden-labs/playwright-devices#47).
    const firstRun =
      '      topResumedActivity=ActivityRecord{70394152 u0 com.android.chrome/org.chromium.chrome.browser.firstrun.FirstRunActivity t11}';
    const { adb, calls } = fakeAdb({ 'shell dumpsys activity activities': `ACTIVITY MANAGER ACTIVITIES\n${firstRun}\n` });
    const { fetchFn } = fakeFetch([new Error('UND_ERR_SOCKET')]);
    const clock = fakeClock();

    await expect(startChromeCold({ adb, fetchFn, clock, port: 9230 })).rejects.toThrow(
      'Chrome shows its first-run screen (org.chromium.chrome.browser.firstrun.FirstRunActivity), which opens no DevTools socket: open Chrome on the phone once and finish its first run, then run again',
    );
    expect(clock.now()).toBe(0);
    expect(calls.filter((call) => call.startsWith('shell am start'))).toHaveLength(1);
  });

  it('keeps waiting while the screen shows anything but the first-run screen', async () => {
    const browsing = '      topResumedActivity=ActivityRecord{1 u0 com.android.chrome/com.google.android.apps.chrome.Main t3}';
    const { adb, calls } = fakeAdb({ 'shell dumpsys activity activities': browsing });
    const { fetchFn } = fakeFetch([new Error('ECONNREFUSED'), VERSION]);

    const started = await startChromeCold({ adb, fetchFn, clock: fakeClock(), port: 9230 });

    expect(started.readyAfterMs).toBe(250);
    expect(calls.filter((call) => call === 'shell dumpsys activity activities')).toHaveLength(1);
  });

  it('stop removes the forward, stops Chrome and removes the command-line file', async () => {
    const { adb, calls } = fakeAdb();
    const { fetchFn } = fakeFetch([VERSION]);
    const started = await startChromeCold({ adb, fetchFn, clock: fakeClock(), port: 9230 });
    calls.length = 0;

    await started.stop();

    expect(calls).toEqual([
      'forward --remove tcp:9230',
      'shell am force-stop com.android.chrome',
      'shell rm -f /data/local/tmp/chrome-command-line',
    ]);
  });
});

describe('requireChromeDebugApp', () => {
  it("passes when Chrome is the phone's debug app", async () => {
    const { adb } = fakeAdb({ 'shell settings get global debug_app': 'com.android.chrome\r\n' });
    await expect(requireChromeDebugApp(adb)).resolves.toBeUndefined();
  });

  it("refuses at once otherwise, naming the setting it found and the command that fixes it, since Playwright's launch would hang", async () => {
    const { adb } = fakeAdb({ 'shell settings get global debug_app': 'null\n' });
    await expect(requireChromeDebugApp(adb)).rejects.toThrow(
      'Chrome is not the debug app (debug_app is "null"), so Playwright\'s launch would wait for a socket Chrome never opens: run adb shell am set-debug-app --persistent com.android.chrome',
    );
  });
});

describe('stopChromeAfterPlaywright', () => {
  it("stops Chrome and removes Playwright's command-line file, which a launch that did not finish leaves behind", async () => {
    const { adb, calls } = fakeAdb();
    await stopChromeAfterPlaywright(adb);
    expect(calls).toEqual(['shell am force-stop com.android.chrome', 'shell rm -f /data/local/tmp/chrome-command-line']);
  });
});
