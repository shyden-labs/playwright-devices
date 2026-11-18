import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutYamlComments, withoutYamlQuotes, yamlBlock } from './source-text.ts';

/**
 * Publishing @shyden-labs/playwright-devices to npmjs.com (Shyden 2026-11-18 on
 * shyden-labs/playwright-devices#16: the registry, with trusted publishing). GitHub Actions signs in
 * to npm through OIDC, so no npm token is stored, and npm attaches provenance itself
 * (docs.npmjs.com/trusted-publishers). The `npm` environment carries Shyden's approval.
 */
const source = readFileSync('.github/workflows/publish.yml', 'utf8');
const workflow = withoutYamlQuotes(withoutYamlComments(source));
const job = yamlBlock(workflow, 'publish', '  ');
const runs = job
  .split(/\n(?= {6}- )/)
  .slice(1)
  .map((step) => /^ {6}(?:- | {2})run: (.*)/m.exec(step)?.[1] ?? '');

describe('publish.yml', () => {
  it('runs when a release is published, and on nothing else', () => {
    expect(yamlBlock(workflow, 'on')).toBe('on:\n  release:\n    types: [published]');
  });

  it('asks for an OIDC token and only reads the repository', () => {
    expect(yamlBlock(job, 'permissions', '    ')).toBe('    permissions:\n      contents: read\n      id-token: write');
  });

  it('waits for the npm environment, where Shyden approves each publish', () => {
    expect(job).toMatch(/^ {4}environment: npm$/m);
  });

  it('checks the tag, installs, builds, drops prepare from the manifest, then publishes, in that order', () => {
    expect(runs.filter((run) => run !== '' && run !== '|')).toEqual([
      'node scripts/npm-ci.ts',
      'npm run build',
      'npm pkg delete scripts.prepare',
      'npm publish --access public',
    ]);
    expect(job).toContain('name: The release tag is v followed by the package version');
  });

  it('points setup-node at the npm registry, which trusted publishing signs in to', () => {
    expect(job).toMatch(/^ {10}registry-url: https:\/\/registry\.npmjs\.org$/m);
  });

  it('uses no stored token: trusted publishing signs in through OIDC', () => {
    expect(source).not.toMatch(/secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN/);
  });
});

describe('package.json, for npm', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>;

  it('can be published: not private, with a semver version', () => {
    expect(pkg['private']).toBeUndefined();
    expect(pkg['version']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('names the repository exactly, which trusted publishing matches against', () => {
    expect(pkg['repository']).toEqual({ type: 'git', url: 'git+https://github.com/shyden-labs/playwright-devices.git' });
  });

  it('publishes the scoped package publicly', () => {
    expect(pkg['publishConfig']).toEqual({ access: 'public' });
  });
});
