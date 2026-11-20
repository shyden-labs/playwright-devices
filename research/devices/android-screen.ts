/**
 * Android's native UI, read from `uiautomator dump` (shyden-labs/playwright-devices#7).
 *
 * Chrome's native <select> list, file chooser and photo picker are not part
 * of the page, so the fixture reads the screen's node tree and touches a node
 * with `adb shell input tap` at its centre.
 */
import type { ScreenPoint } from './wda-client.ts';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_match, name: string) => ENTITIES[name] ?? '');
}

/** One `<node …>` element's text and bounds, from a uiautomator dump. */
const NODE = /<node\b[^>]*?\btext="([^"]*)"[^>]*?\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;

/** The centre of the one node whose text is exactly `text`; undefined when none has it. */
export function centreOfText(dump: string, text: string): ScreenPoint | undefined {
  const hits = [...dump.matchAll(NODE)].filter((node) => unescapeXml(node[1] ?? '') === text);
  if (hits.length > 1) throw new Error(`${hits.length} nodes on the screen read "${text}": cannot tell which to touch`);
  const [hit] = hits;
  if (hit === undefined) return undefined;
  const [left, top, right, bottom] = hit.slice(2, 6).map(Number) as [number, number, number, number];
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/** One `<node …>` element's description and bounds. */
const DESCRIBED = /<node\b[^>]*?\bcontent-desc="([^"]*)"[^>]*?\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;

/**
 * The centre of the topmost, then leftmost, node whose description starts with
 * `prefix`; undefined when none does. Google's photo picker gives each photo
 * no text, only a description such as "Photo taken on …".
 */
export function centreOfFirstDescribed(dump: string, prefix: string): ScreenPoint | undefined {
  const boxes = [...dump.matchAll(DESCRIBED)]
    .filter((node) => unescapeXml(node[1] ?? '').startsWith(prefix))
    .map((node) => node.slice(2, 6).map(Number) as [number, number, number, number])
    .sort(([leftA, topA], [leftB, topB]) => topA - topB || leftA - leftB);
  const [first] = boxes;
  if (first === undefined) return undefined;
  const [left, top, right, bottom] = first;
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}
