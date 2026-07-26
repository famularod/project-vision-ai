import {
  PROJECT_ITEM_TYPES,
  type ProjectItemActivity,
  type ProjectItemType,
} from '../types';

export function normalizeProjectItemType(value: unknown): ProjectItemType {
  return PROJECT_ITEM_TYPES.includes(value as ProjectItemType)
    ? value as ProjectItemType
    : 'Task';
}

export function normalizeProjectItemActivity(
  value: unknown,
  createId: () => string = () => `activity-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
): ProjectItemActivity[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Partial<ProjectItemActivity>;
    const message = clean(record.message);
    if (!message) return [];
    return [{
      id: clean(record.id) || createId(),
      message,
      author: clean(record.author) || 'Project manager',
      createdAt: clean(record.createdAt) || new Date().toISOString(),
    }];
  });
}

export function appendProjectItemActivity({
  activity,
  message,
  author,
  createdAt,
  id,
}: {
  activity: readonly ProjectItemActivity[] | null | undefined;
  message: string;
  author: string;
  createdAt: string;
  id: string;
}): ProjectItemActivity[] {
  const cleanMessage = message.trim();
  if (!cleanMessage) return [...(activity || [])];
  return [
    ...(activity || []),
    {
      id,
      message: cleanMessage,
      author: author.trim() || 'Project manager',
      createdAt,
    },
  ];
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
