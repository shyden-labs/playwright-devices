/**
 * The shared desktop-browser setup (shyden-labs/playwright-devices#17): the same desktop browsers,
 * set up the same way, for every project's Playwright config. Each is a real desktop browser
 * (Playwright's desktop descriptors: no phone emulation, no touch); Chrome and Edge are the
 * installed browsers through their channels. A project may declare a few of them; the same names
 * are the desktop group of the one-suite checks (shyden-labs/playwright-devices#16).
 */
import { devices, type PlaywrightTestProject } from '@playwright/test';

export const DESKTOP_BROWSERS = ['chromium', 'chrome', 'firefox', 'webkit', 'msedge'] as const;

export type DesktopBrowser = (typeof DESKTOP_BROWSERS)[number];

const USE: Record<DesktopBrowser, NonNullable<PlaywrightTestProject['use']>> = {
  chromium: { ...devices['Desktop Chrome'] },
  chrome: { ...devices['Desktop Chrome'], channel: 'chrome' },
  firefox: { ...devices['Desktop Firefox'] },
  webkit: { ...devices['Desktop Safari'] },
  msedge: { ...devices['Desktop Edge'], channel: 'msedge' },
};

function isDesktopBrowser(name: string): name is DesktopBrowser {
  return (DESKTOP_BROWSERS as readonly string[]).includes(name);
}

/** The chosen browsers, checked: known, each once, at least one. */
function chosen(browsers: readonly string[]): DesktopBrowser[] {
  if (browsers.length === 0) throw new Error('choose at least one desktop browser');
  const seen = new Set<string>();
  return browsers.map((name) => {
    if (!isDesktopBrowser(name)) throw new Error(`unknown desktop browser "${name}"; known: ${DESKTOP_BROWSERS.join(', ')}`);
    if (seen.has(name)) throw new Error(`desktop browser "${name}" is named twice`);
    seen.add(name);
    return name;
  });
}

/** Playwright projects for the chosen desktop browsers (all five by default), in the order given. */
export function desktopProjects(browsers: readonly string[] = DESKTOP_BROWSERS): PlaywrightTestProject[] {
  return chosen(browsers).map((name) => ({ name, use: USE[name] }));
}

/** The desktop group for `checkOneSuite`'s `groups`: the chosen browsers' project names. */
export function desktopGroup(browsers: readonly string[] = DESKTOP_BROWSERS): { desktop: string[] } {
  return { desktop: chosen(browsers) };
}
