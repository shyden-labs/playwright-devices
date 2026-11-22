// Probe (shyden-labs/playwright-devices#38): where the Colour tap lands right after typing. On the CI
// emulators and the iPhone Duo simulator the colour list never showed (round 7, 2026-11-21); the Duo's
// screen showed the Name field's edit menu instead. Keeps the device's screen with the keyboard up, just
// after the tap and three seconds later, and the page's geometry at each, in the report.
import { adbFor, test } from '../device-fixture.ts';
import { androidPagePoint, readViewport } from '../android-page-map.ts';
import { connectAndroidScreen, DUMP_COMMAND } from '../android-native.ts';
import { MARKER_LABEL, screenPointsOf } from '../screen-marker.ts';

// Round 11 (Android only): Chrome's page area, the viewport the map reads and the screen point it aims
// at, plus the keyboard window's frame, so round 10's misses (pixel_9 landed 47 CSS px below Colour;
// pixel_tablet's touch never reached the page) can be read against what the map was given.
const serial = process.env.ANDROID_SERIAL;
const onAndroid = serial !== undefined && serial !== '';

// Round 12 (iOS only): round 11 drew the marker at the visual viewport's top and the iPhone Duo's touch
// still landed 92 px above Colour, so that was not the cause. Logs where the marker was drawn on the page,
// where WebDriverAgent read it, where WebDriverAgent lists the Colour field itself, and the point aimed at.
async function iosMap(page: Parameters<typeof screenPointsOf>[0], colour: { x: number; y: number; width: number; height: number }) {
  // The fixture's WebDriverAgent session, reused: opening another would end it.
  const wdaUrl = process.env.WDA_URL ?? 'http://127.0.0.1:8100';
  const wda = async (method: string, path: string, body?: object): Promise<unknown> => {
    const response = await fetch(new URL(path, wdaUrl), {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    return ((await response.json()) as { value: unknown }).value;
  };
  const { sessionId } = (await (await fetch(new URL('/status', wdaUrl))).json()) as { sessionId: string };
  const rectOfId = async (label: string) => {
    const found = (await wda('POST', `/session/${sessionId}/elements`, { using: 'accessibility id', value: label })) as {
      ELEMENT: string;
    }[];
    const [first] = found;
    if (first === undefined) throw new Error(`WebDriverAgent lists no "${label}"`);
    return (await wda('GET', `/session/${sessionId}/element/${first.ELEMENT}/rect`)) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
  const reads: unknown[] = [];
  const reader = {
    rectOf: async (id: string) => {
      const rect = await rectOfId(id);
      reads.push(rect);
      return rect;
    },
  };
  const placed = await page.evaluate(
    () => ({
      offsetTop: window.visualViewport?.offsetTop ?? 0,
      pageTop: window.visualViewport?.pageTop ?? 0,
      scrollY: window.scrollY,
    }),
    undefined,
  );
  const aim = await screenPointsOf(page, reader)(colour);
  const listedColour = await rectOfId('Colour').catch((error: unknown) => String(error));
  return { placed, markerLabel: MARKER_LABEL, markerReads: reads, aim, listedColour };
}

test('the Colour tap after typing', async ({ page, session }, testInfo) => {
  const keep = async (stage: string): Promise<void> => {
    await testInfo.attach(`screen ${stage}`, { body: await session.screenshot(), contentType: 'image/png' });
    const geometry = await page.evaluate(() => ({
      inner: { width: window.innerWidth, height: window.innerHeight },
      visual:
        window.visualViewport === null
          ? null
          : { height: window.visualViewport.height, offsetTop: window.visualViewport.offsetTop, scale: window.visualViewport.scale },
      scrollY: window.scrollY,
      focused: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ?? document.activeElement?.tagName,
    }));
    const colour = await page.getByLabel('Colour').boundingBox();
    const name = await page.getByLabel('Name').boundingBox();
    testInfo.annotations.push({ type: stage, description: JSON.stringify({ geometry, colour, name }) });
    if (!onAndroid && colour !== null) {
      testInfo.annotations.push({ type: `${stage}: ios map`, description: JSON.stringify(await iosMap(page, colour)) });
    }
    if (onAndroid && colour !== null) {
      const adb = adbFor(serial);
      // Round 13: once Colour opens Chrome's option list, the page area is off the screen; say so and go on.
      const area = await connectAndroidScreen({ adb })
        .pageArea()
        .catch((error: unknown) => String(error));
      if (typeof area === 'string') {
        testInfo.annotations.push({ type: `${stage}: android map`, description: area });
        return;
      }
      const viewport = await page.evaluate(readViewport);
      const keyboard = (await adb(['shell', 'dumpsys', 'window', 'InputMethod']))
        .split('\n')
        .filter((line) => /mFrame|frame=|mHasSurface|isVisible|mViewVisibility/.test(line))
        .map((line) => line.trim())
        .slice(0, 12);
      const size = (await adb(['shell', 'wm', 'size'])).trim();
      // Round 12: round 11's pixel_9 touch at client y 418 puts the page's top at screen y 289 with the
      // keyboard up, 123 px above where the map (page area's bottom less the viewport) put it. The whole
      // dump shows which of Chrome's views bounds the page.
      await testInfo.attach(`uiautomator ${stage}`, { body: await adb(DUMP_COMMAND), contentType: 'text/xml' });
      testInfo.annotations.push({
        type: `${stage}: android map`,
        description: JSON.stringify({ area, viewport, aim: androidPagePoint(colour, viewport, area), size, keyboard }),
      });
    }
  };

  await page.goto('/journey.html');
  await page.getByLabel('Name').tap();
  await page.keyboard.type('Ana');
  // Round 10: where on the page each touch lands, and on what, so the tap's aim can be read against
  // the Colour field's box (round 9 showed the tap changed nothing on the Duo and the Android phone).
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { touchesSeen: string[] }).touchesSeen = seen;
    for (const type of ['touchstart', 'pointerdown', 'click', 'focusin']) {
      document.addEventListener(
        type,
        (e) => {
          let point: { clientX: number; clientY: number } | undefined;
          if (e instanceof TouchEvent) point = e.touches[0];
          else if (e instanceof MouseEvent) point = e;
          const at = point === undefined ? 'no point' : `${Math.round(point.clientX)},${Math.round(point.clientY)}`;
          const target =
            e.target instanceof Element ? (e.target.getAttribute('aria-label') ?? (e.target.id || e.target.tagName)) : 'document';
          seen.push(`${type} at ${at} on ${target}`);
        },
        true,
      );
    }
  });
  await keep('1 keyboard up after typing');
  await page.getByLabel('Colour').tap();
  await keep('2 just after the Colour tap');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await keep('3 three seconds later');
  testInfo.annotations.push({
    type: 'touches seen',
    description: JSON.stringify(await page.evaluate(() => (window as unknown as { touchesSeen: string[] }).touchesSeen)),
  });
});
