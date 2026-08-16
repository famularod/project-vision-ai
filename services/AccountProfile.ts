export function accountDisplayNameForMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string {
  const values = metadata || {};
  const accountName = typeof values.project_vision_display_name === 'string'
    ? values.project_vision_display_name.trim()
    : '';
  const fullName = typeof values.full_name === 'string' ? values.full_name.trim() : '';
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  return accountName || fullName || name;
}
