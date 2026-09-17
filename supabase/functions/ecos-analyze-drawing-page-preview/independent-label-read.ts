type Box = { x: number; y: number; width: number; height: number };
type Fact = { statement: string; evidenceText: string; confidence: number; tileIndex?: number; localBounds?: Box };

function printedText(value: string) {
  // Typography only: never replace letters with digits or drop qualifiers.
  return value.replace(/[’′]/g, "'").replace(/[“”″]/g, '"')
    .replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

export function independentLabelReadsAgree(first: Fact, second: Fact): boolean {
  if (first.statement !== first.evidenceText || second.statement !== second.evidenceText ||
      printedText(first.statement) !== printedText(second.statement) ||
      !printedText(first.statement) || first.confidence < .85 || second.confidence < .85 ||
      !Number.isFinite(first.confidence) || !Number.isFinite(second.confidence) ||
      first.confidence > 1 || second.confidence > 1 || first.tileIndex !== 0 || second.tileIndex !== 0) return false;
  const a = first.localBounds, b = second.localBounds;
  if (!a || !b || [a,b].some(box => !Object.values(box).every(Number.isFinite) ||
      box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 ||
      box.x + box.width > 1000 || box.y + box.height > 1000)) return false;
  const area = Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) *
    Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return area / (a.width*a.height+b.width*b.height-area) >= .5;
}
