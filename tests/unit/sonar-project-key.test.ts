import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutYamlComments } from './source-text.ts';

/**
 * CI scans into this repository's own SonarCloud project, never the template's
 * (shyden-labs/playwright-devices#8: the copied ci.yml still named
 * shyden-labs_repo-template, so every scan would have reported there).
 */
describe('the SonarCloud scan', () => {
  it('names this repository’s project key', () => {
    const ci = withoutYamlComments(readFileSync('.github/workflows/ci.yml', 'utf8'));
    expect(ci.match(/project-key:\s*(\S+)/g)).toEqual(['project-key: shyden-labs_playwright-devices']);
  });
});
