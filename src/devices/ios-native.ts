/**
 * Real touches on iOS's own pickers, the steps a person takes
 * (shyden-labs/playwright-devices#7, AC 4; labels measured on the iPhone and
 * the iPad simulator, 2026-11-18/19).
 */

/** The part of the WebDriverAgent client the native steps need. */
export interface NativeScreen {
  tapFirstShown(labels: string[]): Promise<string>;
  tapIfShown(labels: string[]): Promise<string | undefined>;
  tapCellIcon(name: string): Promise<void>;
  waitGone(predicate: string): Promise<void>;
  tapTopLeftOf(predicate: string): Promise<void>;
}

/** A photo in the Photo Library grid: none has a label of its own. */
export const PHOTO_GRID_IMAGE = "type == 'XCUIElementTypeImage' AND name == 'PXGGridLayout-Info'";

/** Safari shows a `<select>`'s options as a native menu of buttons. */
export async function iosChooseOption(screen: NativeScreen, option: string): Promise<void> {
  await screen.tapFirstShown([option]);
}

/** Where the file sits in Files, and its name as Files lists it. */
export interface FileInFiles {
  folder: string;
  label: string;
}

/** Choose File, then the device's own storage (the iPhone goes through Browse; the iPad lists it at once), the folder, the file: Files opens a cell on its icon. */
export async function iosChooseFile(screen: NativeScreen, { folder, label }: FileInFiles): Promise<void> {
  await screen.tapFirstShown(['Choose File']);
  const reached = await screen.tapFirstShown(['Browse', 'On My iPhone', 'On My iPad']);
  if (reached === 'Browse') await screen.tapFirstShown(['On My iPhone', 'On My iPad']);
  await screen.tapCellIcon(folder);
  await screen.tapCellIcon(label);
  // The picker is still closing for a while after the tap; the next touch must not land on it.
  await screen.waitGone(`type == 'XCUIElementTypeCell' AND label BEGINSWITH '${label}, '`);
}

/** Photo Library, the grid's first photo, Done: the picker selects on tap and returns only on Done. */
export async function iosChoosePhoto(screen: NativeScreen): Promise<void> {
  await screen.tapFirstShown(['Photo Library']);
  await screen.tapTopLeftOf(PHOTO_GRID_IMAGE);
  await screen.tapFirstShown(['Done']);
  await screen.waitGone(PHOTO_GRID_IMAGE);
}

/**
 * Closes a native picker a failed step left open: one left open swallowed the
 * next run's touches (2026-11-19 simulator run). Cancel leaves Files and the
 * Photo Library; Done leaves a picker that only Done closes. Looks, never waits.
 */
export async function iosClosePicker(screen: NativeScreen): Promise<void> {
  await screen.tapIfShown(['Cancel']);
  await screen.tapIfShown(['Done']);
}
