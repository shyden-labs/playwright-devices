import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Other projects install the package from npm (Shyden 2026-11-18 on shyden-labs/playwright-devices#16:
 * the registry, with trusted publishing); .github/workflows/publish.yml builds dist/ and publishes it.
 * These pin what projects import and run; installing a pack built that way was measured
 * (research/package/install-2026-11-18.txt, section 10).
 */
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>;
const build = JSON.parse(readFileSync('tsconfig.build.json', 'utf8')) as {
  compilerOptions: { outDir: string };
  include: string[];
};

describe('package.json', () => {
  it('is named for the org, so a project depends on @shyden-labs/playwright-devices', () => {
    expect(pkg['name']).toBe('@shyden-labs/playwright-devices');
  });

  it('exports the checks, the assertion-counting reporter and the desktop browsers from dist, with their types', () => {
    expect(pkg['exports']).toEqual({
      '.': { types: './dist/src/one-suite/check.d.ts', default: './dist/src/one-suite/check.js' },
      './assertion-counter': {
        types: './dist/src/one-suite/assertion-counter.d.ts',
        default: './dist/src/one-suite/assertion-counter.js',
      },
      './desktop': { types: './dist/src/desktop/browsers.d.ts', default: './dist/src/desktop/browsers.js' },
    });
  });

  it('installs the one-suite command from dist, with a path npm publish keeps', () => {
    // npm 11.20 publish drops a bin path starting with ./ as "invalid and removed"; npm pack keeps it
    // (measured 2026-11-18, shyden-labs/playwright-devices#31).
    expect(pkg['bin']).toEqual({ 'one-suite': 'dist/src/one-suite/cli.js' });
    for (const path of Object.values(pkg['bin'] as Record<string, string>)) {
      expect(path.startsWith('./'), path).toBe(false);
    }
  });

  it('ships dist, which the build writes from the one-suite and desktop sources, and NOTICE, which Apache-2.0 requires', () => {
    // npm adds LICENSE, README.md and package.json itself, but not NOTICE (measured with npm pack, 2026-11-18).
    expect(pkg['files']).toEqual(['dist/', 'NOTICE']);
    expect(build.compilerOptions.outDir).toBe('dist');
    expect(build.include).toEqual(['src/one-suite/*.ts', 'src/desktop/*.ts', 'src/devices/**/*.ts']);
  });

  it('takes Playwright from the project, whose reporter types the checks read', () => {
    expect(pkg['peerDependencies']).toEqual({ '@playwright/test': '^1.65.1' });
  });
});

describe('the one-suite command', () => {
  it('starts with a node shebang, which the build keeps, so the installed bin runs under node', () => {
    expect(readFileSync('src/one-suite/cli.ts', 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');
  });
});
