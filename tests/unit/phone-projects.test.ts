import { describe, expect, it } from 'vitest';
import { PHONE_PROJECTS, phoneGroup, phoneProjects, routeOfProject, targetOfProject } from '../../src/devices/phone-projects.ts';

describe('phoneProjects', () => {
  it('makes one project per phone route, in order, with no retries', () => {
    const projects = phoneProjects();
    expect(projects.map((project) => project.name)).toEqual(['iphone', 'android-cdp', 'android-playwright']);
    expect(projects.every((project) => project.retries === 0)).toBe(true);
    expect(PHONE_PROJECTS).toEqual(['iphone', 'android-cdp', 'android-playwright']);
  });

  it('makes only the projects named', () => {
    expect(phoneProjects(['iphone']).map((project) => project.name)).toEqual(['iphone']);
  });

  it('refuses an unknown name, listing the known ones', () => {
    expect(() => phoneProjects(['ipad'])).toThrow('unknown phone project "ipad"; known: iphone, android-cdp, android-playwright');
  });

  it('refuses a name given twice', () => {
    expect(() => phoneProjects(['iphone', 'iphone'])).toThrow('phone project "iphone" is named twice');
  });

  it('refuses an empty choice', () => {
    expect(() => phoneProjects([])).toThrow('choose at least one phone project');
  });
});

describe('phoneGroup', () => {
  it("is the one-suite group of the chosen projects' names", () => {
    expect(phoneGroup()).toEqual({ phones: ['iphone', 'android-cdp', 'android-playwright'] });
    expect(phoneGroup(['android-cdp'])).toEqual({ phones: ['android-cdp'] });
  });
});

describe('routeOfProject and targetOfProject', () => {
  it('drives project iphone over the iOS WebKit route, and the Android projects over their own', () => {
    expect(routeOfProject('iphone')).toBe('ios-webkit');
    expect(routeOfProject('android-cdp')).toBe('android-cdp');
    expect(routeOfProject('android-playwright')).toBe('android-playwright');
  });

  it('refuses a project that is not a phone project', () => {
    expect(() => routeOfProject('chromium')).toThrow('not a phone project: chromium');
  });

  it('names the device each project needs started', () => {
    expect(targetOfProject('iphone')).toBe('iphone');
    expect(targetOfProject('android-cdp')).toBe('android');
    expect(targetOfProject('android-playwright')).toBe('android');
  });
});
