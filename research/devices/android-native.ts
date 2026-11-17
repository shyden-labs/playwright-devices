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
  const box = boundsOf(node);
  if (box === undefined) throw new Error(`the node with the text "${label}" has no bounds`);
  return centre(box);
}

type Box = [left: number, top: number, right: number, bottom: number];

function boundsOf(node: string): Box | undefined {
  const bounds = /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
  return bounds === null ? undefined : (bounds.slice(1).map(Number) as Box);
}

function centre([left, top, right, bottom]: Box): ScreenPoint {
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}

/**
 * The centre of the top-left node whose description starts with `prefix` (topmost, then leftmost),
 * or undefined when none is on screen yet: the first item of a grid such as Android's photo picker.
 */
export function firstByDescription(xml: string, prefix: string): ScreenPoint | undefined {
  const boxes = (xml.match(/<node\b[^>]*>/g) ?? []).flatMap((node) => {
    const description = /\bcontent-desc="([^"]*)"/.exec(node)?.[1];
    if (description === undefined || !unescapeXml(description).startsWith(prefix)) return [];
    const box = boundsOf(node);
    if (box === undefined) throw new Error(`a node described "${unescapeXml(description)}" has no bounds`);
    return [box];
  });
  const [first] = boxes.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return first === undefined ? undefined : centre(first);
}
