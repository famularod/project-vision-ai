/**
 * Report Check shows review flags produced by several internal engines. Their
 * wording names the engines ("Reflection", "Executive Judgment") instead of
 * telling the reviewer what to do. This maps each flag to plain language and
 * lets flags that say the same thing collapse into one item.
 */
const REWRITES: ReadonlyArray<readonly [RegExp, (detail: string) => string]> = [
  [/^Reflection weakened at least one project belief.*$/i,
    () => 'Newer information made an earlier conclusion less certain. Check the report against what you know.'],
  [/^Reflection confidence is low.*$/i,
    () => 'Vitruvius is not fully confident in this report. Read it before sending.'],
  [/^Executive Judgment readiness is .*$/i,
    () => 'Vitruvius is not fully confident in this report. Read it before sending.'],
  [/^Reflection recommends more evidence:\s*(.*)$/i, d => `More information would help: ${d}`],
  [/^Current situation needs evidence:\s*(.*)$/i, d => `More information would help: ${d}`],
  [/^Executive action needs verification:\s*(.*)$/i, d => `Check before acting: ${d}`],
  [/^Wait for evidence before final recommendation:\s*(.*)$/i, d => `Check before acting: ${d}`],
  [/^Current situation needs verification:\s*(.*)$/i, d => `Check before acting: ${d}`],
  [/^Decision timing requires verification:\s*(.*)$/i, d => `Check before acting: ${d}`],
  [/^Executive Judgment identified escalation risk:\s*(.*)$/i, d => `May need escalation: ${d}`],
  [/^Escalation is not justified yet:\s*(.*)$/i, d => `Escalation is not needed yet: ${d}`],
];

export function plainReportReviewFlag(flag: string): string {
  const text = flag.trim().replace(/\s+/g, ' ');
  if (!text) return '';
  let result = text;
  for (const [pattern, rewrite] of REWRITES) {
    const match = pattern.exec(text);
    if (match) {
      result = rewrite((match[1] || '').trim());
      break;
    }
  }
  result = result.replace(/[\s,;:]*([.!?])[\s.,;:!?]*$/, '$1').replace(/[\s,;:]+$/, '');
  return /[.!?]$/.test(result) ? result : `${result}.`;
}

export function plainReportReviewFlags(flags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  flags.forEach(flag => {
    const plain = plainReportReviewFlag(flag);
    const key = plain.toLowerCase();
    if (!plain || seen.has(key)) return;
    seen.add(key);
    result.push(plain);
  });
  return result;
}
