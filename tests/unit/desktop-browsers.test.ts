import { describe, expect, test } from 'vitest';
import { DESKTOP_BROWSERS, desktopGroup, desktopProjects } from '../../src/desktop/browsers.ts';
import { checkOneSuite, type ReportedTest } from '../../src/one-suite/check.ts';

// The shared desktop-browser setup (shyden-labs/playwright-devices#17): each browser a real desktop
// browser, no phone emulation, chosen by name, and the same names form the desktop group of the
// one-suite checks (shyden-labs/playwright-devices#16).

function projectNamed(name: string) {
  const project = desktopProjects().find((p) => p.name === name);
  if (project === undefined) throw new Error(`no project named ${name}`);
  return project;
}

describe('desktopProjects', () => {
  test('lists the five desktop browsers in order by default', () => {
    expect(desktopProjects().map((p) => p.name)).toEqual(['chromium', 'chrome', 'firefox', 'webkit', 'msedge']);
    expect(DESKTOP_BROWSERS).toEqual(['chromium', 'chrome', 'firefox', 'webkit', 'msedge']);
  });

  test('chromium is the bundled Chromium as a desktop browser', () => {
    expect(projectNamed('chromium').use).toMatchObject({ defaultBrowserType: 'chromium', isMobile: false, hasTouch: false });
    expect(projectNamed('chromium').use).not.toHaveProperty('channel');
  });

  test('chrome is Google Chrome through the chrome channel as a desktop browser', () => {
    expect(projectNamed('chrome').use).toMatchObject({
      defaultBrowserType: 'chromium',
      channel: 'chrome',
      isMobile: false,
      hasTouch: false,
    });
  });

  test('firefox is Firefox as a desktop browser', () => {
    expect(projectNamed('firefox').use).toMatchObject({ defaultBrowserType: 'firefox', isMobile: false, hasTouch: false });
  });

  test('webkit is WebKit as a desktop browser', () => {
    expect(projectNamed('webkit').use).toMatchObject({ defaultBrowserType: 'webkit', isMobile: false, hasTouch: false });
  });

  test('msedge is Microsoft Edge through the msedge channel as a desktop browser', () => {
    expect(projectNamed('msedge').use).toMatchObject({
      defaultBrowserType: 'chromium',
      channel: 'msedge',
      isMobile: false,
      hasTouch: false,
    });
  });

  test('a project chooses its own browsers, kept in the order given', () => {
    expect(desktopProjects(['msedge', 'chromium', 'chrome']).map((p) => p.name)).toEqual(['msedge', 'chromium', 'chrome']);
  });

  test('an unknown browser is refused, naming it and the known ones', () => {
    expect(() => desktopProjects(['chromium', 'safari'])).toThrow(
      'unknown desktop browser "safari"; known: chromium, chrome, firefox, webkit, msedge',
    );
  });

  test('a browser named twice is refused, naming it', () => {
    expect(() => desktopProjects(['chrome', 'chrome'])).toThrow('desktop browser "chrome" is named twice');
  });

  test('an empty choice is refused', () => {
    expect(() => desktopProjects([])).toThrow('choose at least one desktop browser');
  });
});

describe('desktopGroup', () => {
  test('is every desktop browser by default, as the one-suite groups take it', () => {
    expect(desktopGroup()).toEqual({ desktop: ['chromium', 'chrome', 'firefox', 'webkit', 'msedge'] });
  });

  test('is the project’s declared browsers when it chooses some', () => {
    expect(desktopGroup(['chromium', 'chrome', 'msedge'])).toEqual({ desktop: ['chromium', 'chrome', 'msedge'] });
  });

  test('refuses the same names desktopProjects refuses', () => {
    expect(() => desktopGroup(['edge'])).toThrow('unknown desktop browser "edge"');
  });

  test('holds a declared group to equal totals in the one-suite checks', () => {
    const passed = (id: string): ReportedTest => ({ id, tags: [], annotations: [], status: 'expected' });
    const both = { tests: [passed('a.spec.ts › reads'), passed('a.spec.ts › writes')] };
    const browsers = ['chromium', 'chrome', 'msedge'];
    const { totals, problems } = checkOneSuite({
      listed: new Map(browsers.map((b) => [b, both])),
      ran: new Map([
        ['chromium', both],
        ['chrome', both],
        ['msedge', { tests: [passed('a.spec.ts › reads')] }],
      ]),
      groups: desktopGroup(browsers),
    });
    expect(totals).toEqual(['chromium: 2 tests', 'chrome: 2 tests', 'msedge: 1 tests']);
    expect(problems.some((line) => line.includes('msedge') && line.includes('a.spec.ts › writes'))).toBe(true);
  });
});
