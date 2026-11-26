import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The README's "Real phones" section, up to the next section (shyden-labs/playwright-devices#54). */
function realPhonesSection(): string {
  const readme = readFileSync('README.md', 'utf8');
  const start = readme.indexOf('\n## Real phones\n');
  if (start === -1) return '';
  const next = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, next === -1 ? undefined : next);
}

describe('the README on real phones', () => {
  it.each([
    'phoneProjects',
    'lanBaseURL',
    'phoneFiles',
    'nativeChooseFile',
    'playwright-devices setup iphone',
    'playwright-devices start iphone',
    'playwright-devices start android',
    'Enable UI Automation',
    'mac-setup/',
    'Select debug app',
    'not routed to real input yet',
    'shyden-labs/playwright-devices#7',
  ])('names %s', (needle) => {
    expect(realPhonesSection()).toContain(needle);
  });

  it('says the simulators and emulators are still being measured', () => {
    expect(realPhonesSection()).toMatch(/simulators and emulators[^.]*still being measured/i);
  });
});
