export function resolvePIEReportProjectNames({
  selectedProjectNames = [],
  fallbackProjectNames = [],
}: {
  selectedProjectNames?: Array<string | null | undefined>;
  fallbackProjectNames?: Array<string | null | undefined>;
}): string[] {
  const explicitSelection = uniqueProjectNames(selectedProjectNames);

  return explicitSelection.length > 0
    ? explicitSelection
    : uniqueProjectNames(fallbackProjectNames);
}

function uniqueProjectNames(
  names: Array<string | null | undefined>,
): string[] {
  const seen = new Set<string>();

  return names.flatMap(name => {
    const cleaned = name?.trim();
    const key = cleaned?.toLowerCase();

    if (!cleaned || !key || seen.has(key)) return [];

    seen.add(key);
    return [cleaned];
  });
}
