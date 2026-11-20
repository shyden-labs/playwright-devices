import { describe, expect, it } from 'vitest';
import { PHOTO_GRID_IMAGE, iosChooseFile, iosChooseOption, iosChoosePhoto, iosClosePicker } from '../../research/devices/ios-native.ts';

/** A native screen stand-in: each look answers the first listed label that is "shown", and records every step. */
function fakeScreen(shown: string[]) {
  const steps: string[] = [];
  return {
    steps,
    tapFirstShown(labels: string[]) {
      const hit = labels.find((label) => shown.includes(label));
      if (hit === undefined) return Promise.reject(new Error(`none of ${labels.join(', ')} showed`));
      steps.push(`tap ${hit}`);
      return Promise.resolve(hit);
    },
    tapIfShown(labels: string[]) {
      const hit = labels.find((label) => shown.includes(label));
      steps.push(hit === undefined ? `look for ${labels.join(', ')}` : `tap ${hit}`);
      return Promise.resolve(hit);
    },
    tapTopLeftOf(predicate: string) {
      steps.push(`tap top-left of ${predicate}`);
      return Promise.resolve();
    },
  };
}

describe('iosChooseOption', () => {
  it('taps the option in Safari’s native menu', async () => {
    const screen = fakeScreen(['Green']);
    await iosChooseOption(screen, 'Green');
    expect(screen.steps).toEqual(['tap Green']);
  });
});

describe('iosChooseFile', () => {
  const file = { folder: 'WebDriverAgentRunner-Runner', label: 'device-journey' };

  it('on the iPhone: Choose File, Browse, On My iPhone, the runner’s folder, the file', async () => {
    const screen = fakeScreen(['Choose File', 'Browse', 'On My iPhone', file.folder, file.label]);
    await iosChooseFile(screen, file);
    expect(screen.steps).toEqual(['tap Choose File', 'tap Browse', 'tap On My iPhone', `tap ${file.folder}`, `tap ${file.label}`]);
  });

  it('on the iPad, whose picker opens with its sidebar: Choose File, On My iPad, the runner’s folder, the file', async () => {
    const screen = fakeScreen(['Choose File', 'On My iPad', file.folder, file.label]);
    await iosChooseFile(screen, file);
    expect(screen.steps).toEqual(['tap Choose File', 'tap On My iPad', `tap ${file.folder}`, `tap ${file.label}`]);
  });
});

describe('iosChoosePhoto', () => {
  it('Photo Library, the first photo in the grid, Done', async () => {
    const screen = fakeScreen(['Photo Library', 'Done']);
    await iosChoosePhoto(screen);
    expect(screen.steps).toEqual(['tap Photo Library', `tap top-left of ${PHOTO_GRID_IMAGE}`, 'tap Done']);
    expect(PHOTO_GRID_IMAGE).toBe("type == 'XCUIElementTypeImage' AND name == 'PXGGridLayout-Info'");
  });
});

describe('iosClosePicker', () => {
  it('a picker left open swallows the next run’s touches: Cancel, then Done, whichever shows', async () => {
    const screen = fakeScreen(['Cancel', 'Done']);
    await iosClosePicker(screen);
    expect(screen.steps).toEqual(['tap Cancel', 'tap Done']);
  });

  it('with no picker open, it only looks', async () => {
    const screen = fakeScreen([]);
    await iosClosePicker(screen);
    expect(screen.steps).toEqual(['look for Cancel', 'look for Done']);
  });
});
