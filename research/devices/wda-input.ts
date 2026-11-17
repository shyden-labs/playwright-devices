/**
 * Real iPhone input through Apple's XCUITest, served by WebDriverAgent (appium-webdriveragent,
 * Apache-2.0), for shyden-labs/playwright-devices#7. Measured on the iPhone Air on 2026-11-17
 * (evidence/ios-wda-steps.txt): a W3C touch action fires a trusted click, `/wda/keys` types into
 * the focused field, and a touch swipe scrolls. WebDriverAgent's `dragfromtoforduration` is a long
 * press, not a swipe, so every finger movement here is a `/actions` touch pointer.
 */
import type { Page } from '@playwright/test';
import type { Box, IosInput } from './ios-wda-page.ts';

export type WdaCall = (method: string, path: string, body?: unknown) => Promise<unknown>;

export interface WdaInput extends IosInput {
  /** A real finger dragged up the middle of the screen, from 45% to 15% of its height. */
  swipeUp: () => Promise<void>;
  /** A real finger tap on the native button labelled `label` (a picker or menu Safari opened). */
  tapNative: (label: string) => Promise<void>;
  close: () => Promise<void>;
}

/** How long a native list may take to open after the tap that opens it, and how often to look. */
const nativeCeilingMs = 3000;
const nativePollMs = 100;

interface Point {
  x: number;
  y: number;
}

/** WebDriverAgent's HTTP API at `baseUrl`; a refusal names the method, path and status. */
export function wdaHttp(baseUrl: string): WdaCall {
  return async (method, path, body) => {
    const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${baseUrl}${path}`, init);
    const json = (await response.json()) as { value: unknown };
    if (!response.ok) throw new Error(`WDA ${method} ${path} ${String(response.status)}: ${JSON.stringify(json.value).slice(0, 200)}`);
    return json.value;
  };
}

export async function openWdaInput(call: WdaCall, page: Page): Promise<WdaInput> {
  const { sessionId } = (await call('POST', '/session', { capabilities: { alwaysMatch: {} } })) as { sessionId: string };
  const session = `/session/${sessionId}`;

  const finger = async (points: Point[], moveMs: number): Promise<void> => {
    const [first, ...rest] = points;
    if (first === undefined) throw new Error('a finger path needs at least one point');
    const actions = [
      { type: 'pointerMove', duration: 0, x: first.x, y: first.y },
      { type: 'pointerDown', button: 0 },
      ...rest.map((point) => ({ type: 'pointerMove', duration: moveMs, x: point.x, y: point.y })),
      { type: 'pointerUp', button: 0 },
    ];
    await call('POST', `${session}/actions`, {
      actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions }],
    });
  };

  // Safari's page starts under its toolbar (68 points on the iPhone Air), which page JavaScript
  // cannot see. So a 100x100 CSS-pixel marker is fixed at the viewport's top-left for one moment,
  // WebDriverAgent reads where it is on screen, and the marker is removed.
  const toScreen = async (box: Box): Promise<Point> => {
    const label = `pw-calibrate-${String(Date.now())}`;
    await page.evaluate((name) => {
      const marker = document.createElement('div');
      marker.id = name;
      marker.setAttribute('role', 'img');
      marker.setAttribute('aria-label', name);
      marker.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px;z-index:2147483647;pointer-events:none';
      document.body.append(marker);
    }, label);
    try {
      const found = (await call('POST', `${session}/element`, { using: 'accessibility id', value: label })) as Record<string, string>;
      const elementId = Object.values(found)[0];
      if (elementId === undefined) throw new Error(`WebDriverAgent found no marker ${label}`);
      const rect = (await call('GET', `${session}/element/${elementId}/rect`)) as { x: number; y: number; width: number };
      const scale = rect.width / 100;
      return { x: Math.round(rect.x + (box.x + box.width / 2) * scale), y: Math.round(rect.y + (box.y + box.height / 2) * scale) };
    } finally {
      await page.evaluate((name) => document.getElementById(name)?.remove(), label);
    }
  };

  return {
    tapAt: async (box) => {
      await finger([await toScreen(box)], 0);
    },
    type: async (text) => {
      await call('POST', `${session}/wda/keys`, { value: Array.from(new Intl.Segmenter().segment(text), (part) => part.segment) });
    },
    swipeUp: async () => {
      const size = (await call('GET', `${session}/window/size`)) as { width: number; height: number };
      const x = Math.round(size.width / 2);
      await finger(
        [
          { x, y: Math.round(size.height * 0.45) },
          { x, y: Math.round(size.height * 0.15) },
        ],
        400,
      );
    },
    tapNative: async (label) => {
      const predicate = `type == "XCUIElementTypeButton" AND label == "${label.replaceAll('"', '\\"')}"`;
      const deadline = Date.now() + nativeCeilingMs;
      let found: Record<string, string> | undefined;
      // A wait for the list to open, at a stated ceiling; the lookup is the condition, not a retried action.
      while (found === undefined) {
        try {
          found = (await call('POST', `${session}/element`, { using: 'predicate string', value: predicate })) as Record<string, string>;
        } catch (error) {
          if (Date.now() >= deadline) {
            const last = error instanceof Error ? error.message : String(error);
            throw new Error(`no native button labelled "${label}" appeared within ${String(nativeCeilingMs)}ms (last: ${last})`, {
              cause: error,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, nativePollMs));
        }
      }
      const rect = (await call('GET', `${session}/element/${String(Object.values(found)[0])}/rect`)) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      await finger([{ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }], 0);
    },
    close: async () => {
      await call('DELETE', session);
    },
  };
}
