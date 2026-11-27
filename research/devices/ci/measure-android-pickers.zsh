#!/bin/zsh
# Measures, never fails: which apps answer Chrome's file chooser and what uiautomator can dump
# (shyden-labs/playwright-devices#38). Chrome sends ACTION_CHOOSER around GET_CONTENT */* with
# CATEGORY_OPENABLE for <input type=file> with no accept (Chromium SelectFileDialog.showExternalPicker).
# adb shell hands its words to the device's shell as one line, so */* is quoted twice: once bare, it
# was globbed there into file paths (round 16).
#
#   measure-android-pickers.zsh <serial> <out-file>
set -u
serial=${1:?usage: measure-android-pickers.zsh <serial> <out-file>}
out=${2:?usage: measure-android-pickers.zsh <serial> <out-file>}
{
  echo "== GET_CONTENT */* OPENABLE resolvers"
  adb -s $serial shell cmd package query-activities --brief -a android.intent.action.GET_CONTENT -t "'*/*'" -c android.intent.category.OPENABLE
  echo "== OPEN_DOCUMENT */* OPENABLE resolvers"
  adb -s $serial shell cmd package query-activities --brief -a android.intent.action.OPEN_DOCUMENT -t "'*/*'" -c android.intent.category.OPENABLE
  echo "== documentsui / media packages"
  adb -s $serial shell pm list packages | grep -i -e documentsui -e providers.media -e photos
  echo "== disabled packages"
  adb -s $serial shell pm list packages -d
  echo "== uiautomator usage"
  adb -s $serial shell uiautomator 2>&1
  adb -s $serial shell uiautomator dump --help 2>&1
} >$out 2>&1
exit 0
