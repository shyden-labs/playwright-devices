/**
 * Finds a native Android control on screen from a `uiautomator dump`, so the device fixture can tap
 * it with a real touch through Android's own input service (shyden-labs/playwright-devices#7 AC 4:
 * Chrome's native <select> list and Android's file chooser are outside the page).
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

function unescapeXml(text: string): string {
  return text.replaceAll(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity);
}

/**
 * The centre of the one node whose whole text is `label`, or undefined when none is on screen yet.
 * Two nodes with the label fail by name: a tap must never land on a guess.
 */
export function centreOfText(xml: string, label: string): ScreenPoint | undefined {
  const nodes = (xml.match(/<node\b[^>]*>/g) ?? []).filter((node) => {
    const text = /\btext="([^"]*)"/.exec(node)?.[1];
    return text !== undefined && unescapeXml(text) === label;
  });
  const [node] = nodes;
  if (node === undefined) return undefined;
  if (nodes.length > 1) throw new Error(`${String(nodes.length)} nodes carry the text "${label}" on screen; a tap needs exactly one`);
  const bounds = /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
  if (bounds === null) throw new Error(`the node with the text "${label}" has no bounds`);
  const [left, top, right, bottom] = bounds.slice(1).map(Number) as [number, number, number, number];
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}
