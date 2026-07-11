export type PIEAttentionItemType =
  | 'open_item'
  | 'safety_observation'
  | 'analysis_failure'
  | 'analysis_timeout'
  | 'document_failure'
  | 'send_failure'
  | 'missing_recipients'
  | 'post_send_resolution';

export type PIEAttentionCategory =
  | 'open_issue'
  | 'safety_concern'
  | 'field_update'
  | 'analysis'
  | 'document'
  | 'delivery'
  | 'unknown';

export type PIEStableAttentionIdentityInput = {
  updateId: string;
  photoId?: string | null;
  category: PIEAttentionCategory;
  itemType: PIEAttentionItemType;
  subtype?: string | null;
};

export function buildStableAttentionItemId(
  input: PIEStableAttentionIdentityInput,
): string {
  return [
    'attention',
    stableIdentityPart(input.updateId),
    stableIdentityPart(input.photoId || 'no-photo'),
    stableIdentityPart(input.category),
    stableIdentityPart(input.itemType),
    stableIdentityPart(input.subtype || 'default'),
  ].join(':');
}

export function attentionCategoryForPhotoCategory(
  category: string | null | undefined,
): PIEAttentionCategory {
  if (category === 'Safety Concern') return 'safety_concern';
  if (category === 'Open Issue') return 'open_issue';
  if (category === 'Update') return 'field_update';
  return 'unknown';
}

export function dedupeAttentionItemsById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function stableIdentityPart(value: string): string {
  return encodeURIComponent(value.trim() || 'unknown');
}
