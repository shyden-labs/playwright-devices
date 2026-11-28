import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutYamlComments, yamlBlock } from './source-text.ts';

/**
 * The desktop browsers come back from GitHub's cache (shyden-labs/playwright-devices#72; Shyden's rule of
 * 2026-11-26: CI caches every download, keyed on the pinned version). Run 46054201591 downloaded every
 * browser afresh, and its first Firefox download ended "server closed connection". Playwright's own
 * browsers sit in ~/.cache/ms-playwright and are pinned by the playwright-core version in the lockfile,
 * so that version is the key: a new Playwright misses the cache and downloads its new browsers.
 */
const ci = withoutYamlComments(readFileSync('.github/workflows/ci.yml', 'utf8'));
const job = yamlBlock(yamlBlock(ci, 'jobs'), 'desktop-e2e', '  ');
const steps = job.split(/\n(?= {6}- )/).slice(1);
const indexOf = (pattern: RegExp) => steps.findIndex((step) => pattern.test(step));

describe('ci.yml desktop-e2e: the desktop browsers come from the cache', () => {
  const version = indexOf(/^ {6}- id: playwright$/m);
  const cache = indexOf(/uses: actions\/cache@[0-9a-f]{40}$/m);
  const install = indexOf(/run: node_modules\/\.bin\/playwright install /);

  it('reads the playwright-core version from the lockfile, failing when it is missing', () => {
    expect(version).toBeGreaterThanOrEqual(0);
    expect(steps[version]).toContain(`packages['node_modules/playwright-core'].version`);
    expect(steps[version]).toContain('test -n "$version"');
    expect(steps[version]).toContain('echo "version=$version" >> "$GITHUB_OUTPUT"');
  });

  it("restores Playwright's browser folder, keyed on that version, the runner's system and its architecture", () => {
    expect(cache).toBeGreaterThanOrEqual(0);
    expect(steps[cache]).toMatch(/^ {10}path: ~\/\.cache\/ms-playwright$/m);
    expect(steps[cache]).toMatch(
      /^ {10}key: playwright-\$\{\{ steps\.playwright\.outputs\.version \}\}-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}$/m,
    );
    expect(steps[cache]).not.toMatch(/restore-keys/);
  });

  it('reads the version, restores, then installs, in that order', () => {
    expect(version).toBeLessThan(cache);
    expect(cache).toBeLessThan(install);
  });

  it('holds no secret and can only read the repository, so nothing it restores reaches a token that can write', () => {
    expect(job).not.toMatch(/secrets\./);
    expect(yamlBlock(job, 'permissions', '    ')).toBe('    permissions:\n      contents: read');
  });
});
