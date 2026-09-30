/**
 * Close Project names the work still queued for the project (audit A7 M2):
 * field updates still upload after it closes; tasks and documents wait until
 * it is reopened.
 */
import { closeProjectMessage, queuedWorkForProject } from '../../services/ProjectCloseGuard';
import type { SyncQueueItem } from '../../services/SyncService';

const item = (entity: SyncQueueItem['entity'], payload: unknown, operation: SyncQueueItem['operation'] = 'update') => ({
  id: `${entity}-${Math.random()}`,
  entity,
  operation,
  payload,
  createdAt: '2026-09-30T09:00:00.000Z',
  changedAt: '2026-09-30T09:00:00.000Z',
  retryCount: 0,
  lastError: null,
}) as SyncQueueItem;

describe('queued work named on Close Project (audit A7 M2)', () => {
  const queue = [
    item('project_update', { id: 'u1', projectName: 'Fire Pump House', updateData: { id: 'u1' } }),
    item('project_update', { id: 'u2', projectName: null, updateData: { id: 'u2', projectName: ' fire pump house ' } }),
    item('project_update', { id: 'u3', archiveOnly: true, projectName: 'Fire Pump House' }),
    item('project_update', { id: 'u4', projectName: 'Fire Pump House' }, 'delete'),
    item('project_update', { id: 'u5', projectName: 'Other Project', updateData: { id: 'u5' } }),
    item('schedule_item', { id: 't1', itemData: { projectName: 'Fire Pump House' } }),
    item('reference_document', { id: 'd1', documentData: { projectName: null, projectNames: ['Other Project', 'Fire Pump House'] } }),
    item('project', { name: 'Fire Pump House' }),
  ];

  it('counts only this project\'s updates, tasks and documents still to upload', () => {
    expect(queuedWorkForProject(queue, 'Fire Pump House')).toEqual({ updates: 2, tasksAndDocuments: 2 });
    expect(queuedWorkForProject(queue, 'Nothing Queued')).toEqual({ updates: 0, tasksAndDocuments: 0 });
    expect(queuedWorkForProject(queue, '  ')).toEqual({ updates: 0, tasksAndDocuments: 0 });
  });

  it('says what happens to waiting work, and nothing extra when none waits', () => {
    expect(closeProjectMessage('Fire Pump House', { updates: 0, tasksAndDocuments: 0 }))
      .toBe('Fire Pump House will move to Archived Projects.');
    expect(closeProjectMessage('Fire Pump House', { updates: 1, tasksAndDocuments: 2 })).toBe(
      'Fire Pump House will move to Archived Projects.\n\n' +
      '1 field update still waiting to upload will upload after it closes.\n\n' +
      '2 task or document changes waiting to upload will wait until you reopen it.',
    );
  });
});
