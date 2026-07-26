import {
  extractPhotoEvidence,
  extractScheduleEvidence,
  extractUserUpdateEvidence,
} from '../../services/PIEEvidenceFusion';
import type { ProjectUpdate, ScheduleItem } from '../../types';

function scheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'task-1',
    projectName: '2375 Compliance Project',
    locationName: 'Canopy C',
    taskName: 'Install hand rails',
    startDate: '2026-07-20',
    finishDate: '2026-07-27',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 50,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-22T14:00:00.000Z',
    progressConfirmedBy: 'pm-user-1',
    priority: 'High',
    status: 'In Progress',
    notes: '',
    importedFrom: 'schedule.pdf',
    importedAt: '2026-07-21T12:00:00.000Z',
    createdAt: '2026-07-21T12:00:00.000Z',
    updatedAt: '2026-07-22T14:00:00.000Z',
    ...overrides,
  };
}

function update(overrides: Partial<ProjectUpdate> = {}): ProjectUpdate {
  return {
    id: 'update-1',
    projectName: '2375 Compliance Project',
    date: '2026-07-22T15:00:00.000Z',
    notes: 'Hand rail layout complete.',
    recipients: { contactIds: [] },
    photos: [{
      id: 'photo-1',
      uri: 'file:///photo.jpg',
      caption: 'Hand rail layout',
      category: 'Update',
      actionRequired: '',
      actionOwner: '',
      actionDueDate: '',
      actionStatus: 'Closed',
      locationCapturedAt: '2026-07-22T14:55:00.000Z',
    }],
    ...overrides,
  };
}

describe('atomic evidence provenance (audit P1-02)', () => {
  it('retains actor, confirmation event, source identity, capture time, and version for PM progress', () => {
    const evidence = extractScheduleEvidence({
      projectName: '2375 Compliance Project',
      scheduleItems: [scheduleItem()],
    });
    const source = evidence[0].sources.find(item => item.type === 'typed-update');

    expect(source?.provenance).toEqual({
      sourceType: 'typed-update',
      sourceRecordId: 'task-1',
      capturedAt: '2026-07-22T14:00:00.000Z',
      actorId: 'pm-user-1',
      confirmationEventId:
        'schedule-progress-confirmation:task-1:2026-07-22T14:00:00.000Z',
      recordVersion: '2026-07-22T14:00:00.000Z',
    });
  });

  it('does not fabricate a confirmation event for legacy progress', () => {
    const evidence = extractScheduleEvidence({
      projectName: '2375 Compliance Project',
      scheduleItems: [scheduleItem({
        progressSource: null,
        progressConfirmedAt: null,
        progressConfirmedBy: null,
      })],
    });
    const source = evidence[0].sources.find(item => item.type === 'typed-update');

    expect(source?.provenance.actorId).toBeNull();
    expect(source?.provenance.confirmationEventId).toBeNull();
  });

  it('keeps photo and note provenance separate without inventing an actor', () => {
    const photo = extractPhotoEvidence({
      projectName: '2375 Compliance Project',
      updates: [update()],
    })[0].sources[0];
    const note = extractUserUpdateEvidence({
      projectName: '2375 Compliance Project',
      updates: [update()],
    })[0].sources[0];

    expect(photo.provenance.sourceRecordId).toBe('photo-1');
    expect(photo.provenance.capturedAt).toBe('2026-07-22T14:55:00.000Z');
    expect(photo.provenance.actorId).toBeNull();
    expect(photo.provenance.confirmationEventId).toBeNull();
    expect(note.provenance.sourceRecordId).toBe('update-1');
    expect(note.provenance.recordVersion).toBe('2026-07-22T15:00:00.000Z');
  });
});
