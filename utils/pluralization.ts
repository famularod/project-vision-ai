export function pluralWord(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return count === 1 ? singular : plural;
}

export function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${count} ${pluralWord(count, singular, plural)}`;
}
