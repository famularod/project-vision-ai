import { buildECOSTalkProjectIntelligence } from '../../services/ECOSTalkProjectIntelligence';
import type { ReferenceDocument } from '../../types';

function referenceDocument(id: string, projectId: string): ReferenceDocument {
  return {
    id,
    projectId,
    projectName: 'Shared Name',
    name: `${id}.pdf`,
    originalFileName: `${id}.pdf`,
    uri: '',
    mimeType: 'application/pdf',
    category: 'Drawing',
    notes: '',
    isCurrent: true,
    importedAt: '2026-08-09T12:00:00.000Z',
  };
}

describe('ECOS Talk immutable project identity', () => {
  it('keeps same-name project B documents isolated from project A', () => {
    const intelligence = buildECOSTalkProjectIntelligence({
      projectId: 'project-b',
      projectName: 'Shared Name',
      legacyNameScopeIsUnambiguous: false,
      updates: [{
        id: 'update-a',
        projectName: 'Shared Name',
        date: '2026-08-09T12:00:00.000Z',
        notes: 'Conflicting A-only field update',
        photos: [],
      } as never],
      scheduleItems: [{
        id: 'task-a',
        projectName: 'Shared Name',
        scheduleProjectName: 'Shared Name',
        locationName: 'A-only area',
        taskName: 'Conflicting A-only task',
        status: 'Not Started',
        priority: 'High',
        percentComplete: 0,
        createdAt: '2026-08-09T12:00:00.000Z',
      } as never],
      projectDocuments: [
        {
          id: 'daily-a',
          projectId: 'project-a',
          name: 'A daily record',
          category: 'Daily',
          status: 'ready',
          createdAt: '2026-08-09T12:00:00.000Z',
        },
        {
          id: 'daily-b',
          projectId: 'project-b',
          name: 'B daily record',
          category: 'Daily',
          status: 'ready',
          createdAt: '2026-08-09T12:00:00.000Z',
        },
      ],
      referenceDocuments: [
        referenceDocument('drawing-a', 'project-a'),
        referenceDocument('drawing-b', 'project-b'),
      ],
      captureMemories: [],
    });

    expect(intelligence.projectId).toBe('project-b');
    expect(intelligence.referenceDocuments.map(document => document.id)).toEqual(['drawing-b']);
    expect(intelligence.dailyBrief.changedItems.map(item => item.sourceRecordId)).toContain('daily-b');
    expect(intelligence.dailyBrief.changedItems.map(item => item.sourceRecordId)).not.toContain('daily-a');
    expect(intelligence.dailyBrief.changedItems.map(item => item.sourceRecordId)).not.toContain('update-a');
    expect(intelligence.scheduleSummary.taskCount).toBe(0);
  });

  it('retains bounded name-derived document compatibility only for a legacy identity', () => {
    const intelligence = buildECOSTalkProjectIntelligence({
      projectId: 'project-shared-name',
      projectName: 'Shared Name',
      legacyNameScopeIsUnambiguous: true,
      updates: [],
      scheduleItems: [],
      projectDocuments: [{
        id: 'legacy-daily',
        projectId: 'Shared Name',
        name: 'Legacy daily record',
        category: 'Daily',
        status: 'ready',
        createdAt: '2026-08-09T12:00:00.000Z',
      }],
      referenceDocuments: [],
      captureMemories: [],
    });

    expect(intelligence.dailyBrief.changedItems.map(item => item.sourceRecordId)).toContain('legacy-daily');
  });

  it('keeps an archived same-name sibling task and update out of exact Talk intelligence', () => {
    const intelligence = buildECOSTalkProjectIntelligence({
      projectId: 'project-a',
      projectName: 'Shared Name',
      legacyNameScopeIsUnambiguous: true,
      updates: [{
        id: 'update-b',
        projectId: 'project-b',
        projectName: 'Shared Name',
        date: '2026-08-09T12:00:00.000Z',
        notes: 'Archived B-only field update',
        photos: [],
        recipients: { contactIds: [] },
      }],
      scheduleItems: [{
        id: 'task-b',
        projectId: 'project-b',
        projectName: 'Shared Name',
        scheduleProjectName: 'Shared Name',
        locationName: 'B-only area',
        taskName: 'Archived B-only task',
        startDate: '',
        finishDate: '',
        milestone: '',
        owner: '',
        contractor: '',
        status: 'Waiting',
        priority: 'High',
        percentComplete: 0,
        notes: '',
        createdAt: '2026-08-09T12:00:00.000Z',
      }],
      projectDocuments: [],
      referenceDocuments: [],
      captureMemories: [],
    });

    expect(intelligence.scheduleSummary.taskCount).toBe(0);
    expect(intelligence.dailyBrief.changedItems.map(item => item.sourceRecordId)).not.toContain('update-b');
    expect(JSON.stringify(intelligence)).not.toContain('task-b');
  });
});
