/**
 * One device's session for the unchanged journey (shyden-labs/playwright-devices#7):
 * the page the test drives, the native steps, the finger scroll, and the
 * teardown, built from parts the fixture connects. Every input is real: iOS
 * through WebDriverAgent, Android through `adb shell input`.
 */
import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import {
  androidChooseFile,
  androidChooseOption,
  androidChoosePhoto,
  androidClosePicker,
  connectAndroidScreen,
  stageAndroidFile,
} from './android-native.ts';
import { androidFingerScroll, iosFingerScroll, type Adb, type IosSwiper } from './finger-scroll.ts';
import { screenPointsOf, type MarkerReader } from './ios-marker.ts';
import { iosChooseFile, iosChooseOption, iosChoosePhoto, iosClosePicker, type FileInFiles, type NativeScreen } from './ios-native.ts';
import { iosPage, type IosInput } from './ios-page.ts';

/** What the journey's fixtures hand the test. */
export interface DeviceSession {
  page: Page;
  nativeChoose(option: string): Promise<void>;
  nativeChooseFile(): Promise<void>;
  nativeChoosePhoto(): Promise<void>;
  fingerScroll(): Promise<void>;
  /** Shuts a picker a failed step left open, then releases the device; call it in the fixture's teardown. */
  close(): Promise<void>;
}

/** Runs `first`, then `last` whatever happened, and reports `first`'s failure. */
async function thenAlways(first: () => Promise<void>, last: () => Promise<void>): Promise<void> {
  try {
    await first();
  } finally {
    await last();
  }
}

/** The WebDriverAgent client, as the iOS session uses it. */
export type IosDevice = IosInput & MarkerReader & IosSwiper & NativeScreen & { close(): Promise<void> };

export interface IosSessionOptions {
  /** Safari's one tab, reached through ios_webkit_debug_proxy. */
  page: Page;
  wda: IosDevice;
  baseURL: string;
  /** Where the journey's document sits in Files, and its name there. */
  file: FileInFiles;
}

export function iosSession({ page, wda, baseURL, file }: IosSessionOptions): DeviceSession {
  return {
    page: iosPage(page, { input: wda, toScreen: screenPointsOf(page, wda), baseURL }),
    nativeChoose: (option) => iosChooseOption(wda, option),
    nativeChooseFile: () => iosChooseFile(wda, file),
    nativeChoosePhoto: () => iosChoosePhoto(wda),
    fingerScroll: () => iosFingerScroll(wda),
    close: () =>
      thenAlways(
        () => iosClosePicker(wda),
        () => wda.close(),
      ),
  };
}

export interface AndroidSessionOptions {
  /** Chrome's page, its input already Android's own on this route. */
  page: Page;
  adb: Adb;
  /** The journey's document and photo, on this Mac. */
  files: { document: string; photo: string };
}

/** Stages the journey's files on the phone (the pickers list only indexed files), and answers the session. */
export async function androidSession({ page, adb, files }: AndroidSessionOptions): Promise<DeviceSession> {
  const screen = connectAndroidScreen({ adb });
  const removeDocument = await stageAndroidFile(adb, files.document, '/sdcard/Download');
  const removePhoto = await stageAndroidFile(adb, files.photo, '/sdcard/Pictures');
  return {
    page,
    nativeChoose: (option) => androidChooseOption(screen, option),
    nativeChooseFile: () => androidChooseFile(screen, basename(files.document)),
    nativeChoosePhoto: () => androidChoosePhoto(screen),
    fingerScroll: () => androidFingerScroll(adb),
    close: () =>
      thenAlways(
        () => androidClosePicker(screen),
        () => thenAlways(removeDocument, removePhoto),
      ),
  };
}
