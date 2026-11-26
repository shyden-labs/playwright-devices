/**
 * The real phones as Playwright projects (shyden-labs/playwright-devices#54):
 * `iphone` (Safari, through WebDriverAgent and ios_webkit_debug_proxy) and the
 * two Android routes, `android-cdp` and `android-playwright` (Chrome). The
 * project's name picks the route the `phones` fixture connects.
 */
import type { PlaywrightTestProject } from '@playwright/test';
import type { Route } from './device-session.ts';

export const PHONE_PROJECTS = ['iphone', 'android-cdp', 'android-playwright'] as const;

export type PhoneProject = (typeof PHONE_PROJECTS)[number];

/** The device `playwright-devices start` must have started for a project. */
export type PhoneTarget = 'iphone' | 'android';

function isPhoneProject(name: string): name is PhoneProject {
  return (PHONE_PROJECTS as readonly string[]).includes(name);
}

/** The chosen projects, checked: known, each once, at least one. */
function chosen(names: readonly string[]): PhoneProject[] {
  if (names.length === 0) throw new Error('choose at least one phone project');
  const seen = new Set<string>();
  return names.map((name) => {
    if (!isPhoneProject(name)) throw new Error(`unknown phone project "${name}"; known: ${PHONE_PROJECTS.join(', ')}`);
    if (seen.has(name)) throw new Error(`phone project "${name}" is named twice`);
    seen.add(name);
    return name;
  });
}

/** Playwright projects for the chosen phone routes (all three by default), in the order given. No retries: a failure is found and fixed. */
export function phoneProjects(names: readonly string[] = PHONE_PROJECTS): PlaywrightTestProject[] {
  return chosen(names).map((name) => ({ name, retries: 0 }));
}

/** The phones group for `checkOneSuite`'s `groups`: the chosen projects' names. */
export function phoneGroup(names: readonly string[] = PHONE_PROJECTS): { phones: string[] } {
  return { phones: chosen(names) };
}

/** The route a phone project connects over. */
export function routeOfProject(name: string): Route {
  if (!isPhoneProject(name)) throw new Error(`not a phone project: ${name}`);
  return name === 'iphone' ? 'ios-webkit' : name;
}

/** The device a phone project needs `playwright-devices start` to have started. */
export function targetOfProject(name: PhoneProject): PhoneTarget {
  return name === 'iphone' ? 'iphone' : 'android';
}
