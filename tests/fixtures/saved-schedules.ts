import type { ReferenceDocument, ScheduleItem } from '../../types';
import { scheduleItemImportBatchIds } from '../../services/ScheduleImportProvenance';

/**
 * The schedules behind saved tasks, for tests that compile App code asking
 * which tasks are shown (Talk's Undo, whole-app audit A10 pass 8 L2): one
 * current schedule per import, dated by when its own rows were imported, so
 * the newest import is the one shown. An import known only from a task it
 * restated in place is dated last.
 */
export function schedulesOfSavedTasks(items: readonly ScheduleItem[]): ReferenceDocument[] {
  const imports = new Map<string, { importedAt: string; projects: Set<string> }>();
  items.forEach(item => scheduleItemImportBatchIds(item).forEach(batch => {
    const entry = imports.get(batch) || { importedAt: '', projects: new Set<string>() };
    if (item.importBatchId === batch && (item.importedAt || '') > entry.importedAt) entry.importedAt = item.importedAt || '';
    entry.projects.add(item.projectName);
    imports.set(batch, entry);
  }));
  return [...imports.entries()].map(([batch, entry]) => {
    const id = batch.replace(/^batch-/, '');
    return {
      id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true,
      importedAt: entry.importedAt || '2099-01-01T00:00:00.000Z', projectId: null, projectName: [...entry.projects][0] || null,
      projectNames: [...entry.projects], importBatchId: batch,
    } as ReferenceDocument;
  });
}
