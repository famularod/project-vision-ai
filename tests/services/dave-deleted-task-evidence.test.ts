import {
  DELETED_TASK_EVIDENCE_LABEL,
  partitionProjectUpdatesByDeletedTask,
} from '../../services/DAVEDeletedTaskEvidence';
import type { DAVESyncTombstone, ProjectUpdate } from '../../types';
import fs from 'fs';
import path from 'path';

describe('deleted task evidence policy', () => {
  const tombstones: DAVESyncTombstone[] = [{
    entityType: 'schedule_item',
    recordId: 'Task-Deleted',
    deletedAt: '2026-07-22T12:00:00.000Z',
  }];
  const updates: ProjectUpdate[] = [
    {
      id: 'project-only',
      projectName: '2375 Compliance Project',
      date: '2026-07-22T12:01:00.000Z',
      photos: [],
      notes: 'Project-only evidence.',
      recipients: { contactIds: [] },
    },
    {
      id: 'deleted-task-evidence',
      projectName: '2375 Compliance Project',
      date: '2026-07-22T12:02:00.000Z',
      photos: [],
      notes: 'Preserve this audit history.',
      recipients: { contactIds: [] },
      scheduleItemId: ' task-deleted ',
    },
  ];

  test('keeps audit history separate from active project truth', () => {
    const partition = partitionProjectUpdatesByDeletedTask(
      updates,
      tombstones,
      update => update,
    );

    expect(partition.active.map(update => update.id)).toEqual(['project-only']);
    expect(partition.historical.map(update => update.id)).toEqual([
      'deleted-task-evidence',
    ]);
    expect(DELETED_TASK_EVIDENCE_LABEL).toContain('Historical evidence');
  });

  test('supports the cloud wrapper used by web without changing the policy', () => {
    const cloudRows = updates.map(update => ({ updateData: update }));
    const partition = partitionProjectUpdatesByDeletedTask(
      cloudRows,
      tombstones,
      value => value.updateData,
    );

    expect(partition.active).toHaveLength(1);
    expect(partition.historical).toHaveLength(1);
  });

  test('native current-state surfaces use active evidence while history labels the rest', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain('const activeSavedUpdates = savedUpdateTaskEvidence.active');
    expect(app).toContain('savedUpdates={activeSavedUpdates}');
    expect(app).toContain('deletedTaskEvidenceIds={deletedTaskEvidenceIds}');
    expect(app).toContain('{DELETED_TASK_EVIDENCE_LABEL}');
  });
});
