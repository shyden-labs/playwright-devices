import { describe, expect, it } from 'vitest';
import { setupIphone, type SetupOptions } from '../../src/devices/cli/setup.ts';
import type { Spawner } from '../../src/devices/cli/spawner.ts';

const RUNNER = '/wda/derived/Build/Products/Debug-iphoneos/WebDriverAgentRunner-Runner.app';

interface Script {
  unsigned?: boolean;
  sourceMissing?: boolean;
  buildCode?: number;
  alreadyShared?: boolean;
  identityListed?: boolean;
  verifyCode?: number;
}

/** A Spawner recording each command and file write, answering from `script`. */
function fakeSpawner(script: Script = {}) {
  const calls: string[] = [];
  const printed: string[] = [];
  const written: Record<string, string> = {};
  const answer = (code: number, stdout = '', stderr = '') => Promise.resolve({ code, stdout, stderr });
  const spawner = {
    run(command: string, args: string[]) {
      const call = [command, ...args].join(' ');
      calls.push(call.startsWith('ruby') ? `ruby -rxcodeproj -e <signing script> ${args.slice(3).join(' ')}` : call);
      if (command === 'test') return answer(script.sourceMissing === true ? 1 : 0);
      if (command === 'xcodebuild')
        return answer(script.buildCode ?? 0, '', 'error: Signing for "WebDriverAgentRunner" requires a development team.\n');
      if (call.includes('Print :UIFileSharingEnabled')) return answer(script.alreadyShared === true ? 0 : 1);
      if (call === `codesign -dvv ${RUNNER}`) {
        const signed = 'Executable=x\nAuthority=Apple Development: Example (ABC)\nAuthority=Apple WWDR\n';
        return answer(0, '', script.unsigned === true ? 'Executable=x\nSignature=adhoc\n' : signed);
      }
      if (command === 'security') {
        const listed = script.identityListed === false ? '' : '  1) 0123ABCD "Apple Development: Example (ABC)"\n';
        return answer(0, `${listed}     1 valid identities found\n`);
      }
      if (call.startsWith('codesign -d --entitlements')) return answer(0, '<plist>entitlements</plist>');
      if (call.startsWith('codesign -v')) return answer(script.verifyCode ?? 0, '', 'invalid signature');
      return answer(0);
    },
    writeFile(path: string, text: string) {
      calls.push(`write ${path}`);
      written[path] = text;
      return Promise.resolve();
    },
    now: () => Date.parse('2026-11-26T01:00:00Z'),
    print(line: string) {
      printed.push(line);
    },
  } as unknown as Spawner;
  return { spawner, calls, printed, written };
}

const options: SetupOptions = {
  udid: 'U',
  team: 'TEAM1',
  profile: 'Example Wildcard',
  bundle: 'org.example.WebDriverAgentRunner',
  wdaSource: '/src/WebDriverAgent',
  wdaDir: '/wda',
};

describe('setup iphone', () => {
  it('copies the source, signs it with the team, profile and bundle given, builds it, shares its files, and records the build', async () => {
    const fake = fakeSpawner();
    expect(await setupIphone(options, fake.spawner)).toBe(0);
    expect(fake.calls).toEqual([
      'test -d /src/WebDriverAgent/WebDriverAgent.xcodeproj',
      'rm -rf /wda/src',
      'mkdir -p /wda',
      'cp -R /src/WebDriverAgent /wda/src',
      'ruby -rxcodeproj -e <signing script> /wda/src/WebDriverAgent.xcodeproj TEAM1 Example Wildcard org.example.WebDriverAgentRunner',
      'xcodebuild build-for-testing -quiet -project /wda/src/WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner -destination id=U -derivedDataPath /wda/derived',
      `/usr/libexec/PlistBuddy -c Print :UIFileSharingEnabled ${RUNNER}/Info.plist`,
      `codesign -dvv ${RUNNER}`,
      'security find-identity -v -p codesigning',
      `codesign -d --entitlements - --xml ${RUNNER}`,
      'write /wda/runner-entitlements.plist',
      `/usr/libexec/PlistBuddy -c Add :UIFileSharingEnabled bool true -c Add :LSSupportsOpeningDocumentsInPlace bool true ${RUNNER}/Info.plist`,
      `codesign -f -s 0123ABCD --entitlements /wda/runner-entitlements.plist --preserve-metadata=identifier,flags ${RUNNER}`,
      `codesign -v --strict ${RUNNER}`,
      'write /wda/setup.json',
    ]);
    expect(fake.written['/wda/runner-entitlements.plist']).toBe('<plist>entitlements</plist>');
    expect(JSON.parse(fake.written['/wda/setup.json'] ?? '')).toEqual({
      team: 'TEAM1',
      profile: 'Example Wildcard',
      bundle: 'org.example.WebDriverAgentRunner',
      builtAt: '2026-11-26T01:00:00.000Z',
    });
  });

  it('skips sharing and re-signing when the build already shares its files', async () => {
    const fake = fakeSpawner({ alreadyShared: true });
    expect(await setupIphone(options, fake.spawner)).toBe(0);
    expect(fake.calls.filter((call) => call.startsWith('codesign'))).toEqual([]);
    expect(fake.calls.at(-1)).toBe('write /wda/setup.json');
  });

  it('refuses a source with no WebDriverAgent project, changing nothing', async () => {
    const fake = fakeSpawner({ sourceMissing: true });
    expect(await setupIphone(options, fake.spawner)).toBe(2);
    expect(fake.printed).toEqual(['playwright-devices: no WebDriverAgent.xcodeproj in /src/WebDriverAgent']);
    expect(fake.calls).toEqual(['test -d /src/WebDriverAgent/WebDriverAgent.xcodeproj']);
  });

  it("answers the build's exit code and its last error line, recording no build", async () => {
    const fake = fakeSpawner({ buildCode: 65 });
    expect(await setupIphone(options, fake.spawner)).toBe(65);
    expect(fake.printed).toEqual([
      'playwright-devices: building WebDriverAgent failed (exit 65): error: Signing for "WebDriverAgentRunner" requires a development team.',
    ]);
    expect(fake.written).toEqual({});
  });

  it('refuses when the keychain holds no identity for the build’s signer', async () => {
    const fake = fakeSpawner({ identityListed: false });
    expect(await setupIphone(options, fake.spawner)).toBe(2);
    expect(fake.printed).toEqual(["playwright-devices: no signing identity for 'Apple Development: Example (ABC)' in the keychain"]);
    expect(fake.written).toEqual({});
  });

  it('refuses a build that no development certificate signed', async () => {
    const fake = fakeSpawner({ unsigned: true });
    expect(await setupIphone(options, fake.spawner)).toBe(2);
    expect(fake.printed).toEqual([`playwright-devices: the built runner has no signing authority: ${RUNNER}; check the team and profile`]);
    expect(fake.written).toEqual({});
  });

  it('lets an unexpected failure through', async () => {
    const fake = fakeSpawner();
    fake.spawner.run = () => Promise.reject(new Error('spawn test ENOENT'));
    await expect(setupIphone(options, fake.spawner)).rejects.toThrow('spawn test ENOENT');
  });

  it('fails, recording no build, when the re-signed runner does not verify', async () => {
    const fake = fakeSpawner({ verifyCode: 1 });
    expect(await setupIphone(options, fake.spawner)).toBe(1);
    expect(fake.printed).toEqual(['playwright-devices: checking the re-signed runner failed (exit 1): invalid signature']);
    expect(fake.written['/wda/setup.json']).toBeUndefined();
  });
});
