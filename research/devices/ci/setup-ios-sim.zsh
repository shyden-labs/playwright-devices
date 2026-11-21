#!/bin/zsh
# Prepares a GitHub-hosted macOS runner for `run-journey.zsh ios-sim` (shyden-labs/playwright-devices#38):
# builds WebDriverAgent for the booted simulator the way the laptop's cached build was made, and loads
# the pf rule the run script requires. The runner is a fresh machine, so nothing here is undone.
#
#   setup-ios-sim.zsh <udid>
set -euo pipefail

udid=${1:?usage: setup-ios-sim.zsh <udid>}
repo=${0:A:h:h:h:h}
wda=$HOME/Library/Caches/playwright-devices/wda
derived=$wda/derived-sim
# The version measured on the laptop (docs/research/2026-11-playwright-on-devices.md).
wda_version=14.1.1

mkdir -p $wda
(cd $wda && npm pack appium-webdriveragent@$wda_version --silent >/dev/null && tar -xzf appium-webdriveragent-$wda_version.tgz && mv package src)
# The run script copies the journey's file into this bundle id's container.
sed -i '' 's/PRODUCT_BUNDLE_IDENTIFIER = com.facebook.WebDriverAgentRunner;/PRODUCT_BUNDLE_IDENTIFIER = uk.co.shyden.WebDriverAgentRunner;/' \
  $wda/src/WebDriverAgent.xcodeproj/project.pbxproj
grep -q 'uk.co.shyden.WebDriverAgentRunner;' $wda/src/WebDriverAgent.xcodeproj/project.pbxproj

# Ad-hoc signed: unsigned, the runner is refused at launch with "Application failed preflight checks"
# (measured 2026-11-18, Xcode 27.2).
xcodebuild build-for-testing -quiet -project $wda/src/WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner \
  -destination id=$udid -derivedDataPath $derived \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=

# Safari's Files picker lists an app's Documents only when the app declares file sharing; Xcode
# generates the Info.plist, so the keys go into the built app, which is signed again (2026-11-19, run 6-7).
runner=($derived/Build/Products/*-iphonesimulator/WebDriverAgentRunner-Runner.app(N))
[[ -n ${runner[1]:-} ]] || { print -u2 "no WebDriverAgentRunner-Runner.app under $derived"; exit 1; }
runner=${runner[1]}
entitlements=$(mktemp)
# A runner built without entitlements has none to read; codesign then fails and the file stays empty.
if ! codesign -d --entitlements - --xml $runner >$entitlements 2>/dev/null; then : >$entitlements; fi
/usr/libexec/PlistBuddy -c 'Add :UIFileSharingEnabled bool true' -c 'Add :LSSupportsOpeningDocumentsInPlace bool true' $runner/Info.plist
if [[ -s $entitlements ]]; then
  codesign -f -s - --entitlements $entitlements --preserve-metadata=identifier,flags $runner
else
  codesign -f -s - --preserve-metadata=identifier,flags $runner
fi
codesign -v --strict $runner

# The run script refuses to start ios_webkit_debug_proxy without the pf rule that keeps its ports to
# this machine (shyden-labs/playwright-devices#19).
sudo cp $repo/research/devices/mac-setup/pf.shyden.conf /etc/pf.shyden.conf
sudo pfctl -E -f /etc/pf.shyden.conf
sudo pfctl -sr | grep -q '9221:9322' || { print -u2 'pf did not load the 9221-9322 rule'; exit 1; }
