/** The report's existing ASCII name order, with an ordering-only Unicode fallback.
 * Names whose ASCII keys contain anything keep their previous comparison, including
 * ties. Two names with empty keys are compared by Unicode scalar values so their
 * order does not depend on which project was selected or had the latest note.
 * This does not normalize project identity or change a saved report's fingerprints.
 */
export function reportProjectNameOrder(left: string, right: string): number {
  const key = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const leftKey = key(left);
  const rightKey = key(right);
  if (leftKey || rightKey) return leftKey.localeCompare(rightKey);

  const leftScalars = Array.from(left.trim().toLowerCase());
  const rightScalars = Array.from(right.trim().toLowerCase());
  for (let index = 0; index < Math.min(leftScalars.length, rightScalars.length); index += 1) {
    const difference = leftScalars[index].codePointAt(0)! - rightScalars[index].codePointAt(0)!;
    if (difference) return difference;
  }
  return leftScalars.length - rightScalars.length;
}
