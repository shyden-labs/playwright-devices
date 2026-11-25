/**
 * `playwright-devices setup iphone <udid> --team --profile --bundle --wda-source`
 * (shyden-labs/playwright-devices#54): builds and signs WebDriverAgent once
 * for the iPhone, so `start iphone` can run it. WebDriverAgent is built from
 * the source given, never shipped. Safari's Files picker lists the runner's
 * Documents only when the app declares file sharing, and Xcode writes the
 * runner's Info.plist, so the two keys go into the built app, which is signed
 * again with the identity and entitlements it already had (measured
 * 2026-11-18 on the iPhone Air).
 */
import type { Spawner } from './spawner.ts';

export interface SetupOptions {
  udid: string;
  /** The Apple development team id. */
  team: string;
  /** The provisioning profile's name, for the runner only: frameworks sign without one. */
  profile: string;
  /** The runner's bundle id; the phone installs it as `<bundle>.xctrunner`. */
  bundle: string;
  /** A WebDriverAgent checkout (Appium's appium-webdriveragent). */
  wdaSource: string;
  /** Where the signed copy, the build and `setup.json` go. */
  wdaDir: string;
}

/** Sets manual signing on every target; only the runner carries the profile and the bundle id. */
const SIGNING_SCRIPT = `
team, profile, bundle = ARGV[1], ARGV[2], ARGV[3]
proj = Xcodeproj::Project.open(ARGV[0])
proj.targets.each do |t|
  t.build_configurations.each do |c|
    bs = c.build_settings
    bs["CODE_SIGN_STYLE"] = "Manual"
    bs["DEVELOPMENT_TEAM"] = team
    bs["CODE_SIGN_IDENTITY"] = "Apple Development"
    if t.name == "WebDriverAgentRunner"
      bs["PROVISIONING_PROFILE_SPECIFIER"] = profile
      bs["PRODUCT_BUNDLE_IDENTIFIER"] = bundle
    else
      bs["PROVISIONING_PROFILE_SPECIFIER"] = ""
      bs.delete("PROVISIONING_PROFILE")
    end
  end
end
proj.save
`;

/** A setup step that failed: the exit code to answer and the line that says why. */
class SetupFailed extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function lastLine(text: string): string {
  const trimmed = text.trim();
  return trimmed.slice(trimmed.lastIndexOf('\n') + 1);
}

/** Builds, signs and records WebDriverAgent; answers 0, or the failing step's exit code (2 for a refusal). */
export async function setupIphone(options: SetupOptions, spawner: Spawner): Promise<number> {
  const { wdaDir } = options;
  const project = `${wdaDir}/src/WebDriverAgent.xcodeproj`;
  const runner = `${wdaDir}/derived/Build/Products/Debug-iphoneos/WebDriverAgentRunner-Runner.app`;

  async function step(what: string, command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    const result = await spawner.run(command, args);
    if (result.code !== 0) throw new SetupFailed(result.code, `${what} failed (exit ${result.code}): ${lastLine(result.stderr)}`);
    return result;
  }

  async function shareFiles(): Promise<void> {
    const plist = `${runner}/Info.plist`;
    if ((await spawner.run('/usr/libexec/PlistBuddy', ['-c', 'Print :UIFileSharingEnabled', plist])).code === 0) return;
    const { stderr } = await step('reading the runner’s signature', 'codesign', ['-dvv', runner]);
    const authority = /^Authority=(.*)$/m.exec(stderr)?.[1];
    if (authority === undefined)
      throw new SetupFailed(2, `the built runner has no signing authority: ${runner}; check the team and profile`);
    const { stdout: identities } = await step('listing signing identities', 'security', ['find-identity', '-v', '-p', 'codesigning']);
    const identity = identities
      .split('\n')
      .find((line) => line.includes(`"${authority}"`))
      ?.trim()
      .split(/\s+/)[1];
    if (identity === undefined) throw new SetupFailed(2, `no signing identity for '${authority}' in the keychain`);
    const { stdout: entitlements } = await step('reading the runner’s entitlements', 'codesign', [
      '-d',
      '--entitlements',
      '-',
      '--xml',
      runner,
    ]);
    const entitlementsFile = `${wdaDir}/runner-entitlements.plist`;
    await spawner.writeFile(entitlementsFile, entitlements);
    const keys = ['-c', 'Add :UIFileSharingEnabled bool true', '-c', 'Add :LSSupportsOpeningDocumentsInPlace bool true'];
    await step('declaring file sharing', '/usr/libexec/PlistBuddy', [...keys, plist]);
    const sign = ['-f', '-s', identity, '--entitlements', entitlementsFile, '--preserve-metadata=identifier,flags', runner];
    await step('signing the runner again', 'codesign', sign);
    await step('checking the re-signed runner', 'codesign', ['-v', '--strict', runner]);
  }

  try {
    if ((await spawner.run('test', ['-d', `${options.wdaSource}/WebDriverAgent.xcodeproj`])).code !== 0) {
      throw new SetupFailed(2, `no WebDriverAgent.xcodeproj in ${options.wdaSource}`);
    }
    await step('removing the old copy', 'rm', ['-rf', `${wdaDir}/src`]);
    await step('making the build folder', 'mkdir', ['-p', wdaDir]);
    await step('copying the source', 'cp', ['-R', options.wdaSource, `${wdaDir}/src`]);
    await step('setting the signing', 'ruby', [
      '-rxcodeproj',
      '-e',
      SIGNING_SCRIPT,
      project,
      options.team,
      options.profile,
      options.bundle,
    ]);
    const destination = ['-destination', `id=${options.udid}`, '-derivedDataPath', `${wdaDir}/derived`];
    const build = ['build-for-testing', '-quiet', '-project', project, '-scheme', 'WebDriverAgentRunner', ...destination];
    await step('building WebDriverAgent', 'xcodebuild', build);
    await shareFiles();
    const record = { team: options.team, profile: options.profile, bundle: options.bundle, builtAt: new Date(spawner.now()).toISOString() };
    await spawner.writeFile(`${wdaDir}/setup.json`, `${JSON.stringify(record, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof SetupFailed)) throw error;
    spawner.print(`playwright-devices: ${error.message}`);
    return error.code;
  }
}
