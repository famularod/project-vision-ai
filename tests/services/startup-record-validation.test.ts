import {
  isStartupContactBook,
  isStartupDeletedUpdateRecord,
  isStartupDraftEnvelope,
  isStartupProjectAreaRecord,
  isStartupProjectName,
  isStartupProjectRecord,
  isStartupReferenceDocumentRecord,
  isStartupSavedUpdateRecord,
  isStartupScheduleItemRecord,
  isStartupStandaloneProjectDocumentRecord,
  salvageStartupContactBook,
} from '../../services/StartupRecordValidation';

describe('startup record validation', () => {
  it('accepts supported legacy records while rejecting default-fabricating rows', () => {
    expect(isStartupProjectRecord('Legacy project')).toBe(true);
    expect(isStartupProjectRecord({ name: 'Record project' })).toBe(true);
    expect(isStartupProjectRecord({})).toBe(false);
    expect(isStartupProjectName(' Project ')).toBe(true);
    expect(isStartupProjectName('')).toBe(false);

    expect(isStartupProjectAreaRecord({
      name: 'Legacy area without id or radius',
      projectName: 'Project A',
      latitude: 34.1,
      longitude: -118.2,
    })).toBe(true);
    expect(isStartupProjectAreaRecord({ name: 'Would receive default GPS' })).toBe(false);

    expect(isStartupScheduleItemRecord({ taskName: 'Legacy task without id' })).toBe(true);
    expect(isStartupScheduleItemRecord({})).toBe(false);
  });

  it('validates optional structured schedule planning data', () => {
    expect(isStartupScheduleItemRecord({
      taskName: 'Install structure',
      wbsCode: '1.2',
      parentItemId: 'phase-1',
      sortOrder: 2,
      dependencies: [{
        predecessorItemId: 'foundations',
        type: 'FS',
        lagDays: 1,
      }],
      isMilestone: false,
      isSummary: true,
      baselineStartDate: '2026-07-20',
      baselineFinishDate: '2026-07-24',
    })).toBe(true);
    expect(isStartupScheduleItemRecord({
      taskName: 'Invalid predecessor',
      dependencies: [{ type: 'FS' }],
    })).toBe(false);
    expect(isStartupScheduleItemRecord({
      taskName: 'Invalid relationship',
      dependencies: [{ predecessorItemId: 'a', type: 'SS' }],
    })).toBe(false);
    expect(isStartupScheduleItemRecord({
      taskName: 'Invalid lag',
      dependencies: [{ predecessorItemId: 'a', type: 'FS', lagDays: 'two' }],
    })).toBe(false);
    expect(isStartupScheduleItemRecord({
      taskName: 'Invalid milestone',
      isMilestone: 'yes',
    })).toBe(false);
    expect(isStartupScheduleItemRecord({
      taskName: 'Invalid phase',
      isSummary: 'yes',
    })).toBe(false);
  });

  it('rejects nested update rows that normalization would silently erase', () => {
    expect(isStartupSavedUpdateRecord({
      id: 'update-1',
      projectName: 'Project',
      photos: [{ uri: 'file:///photo.jpg' }],
      documents: [{ name: 'Plan', uri: 'file:///plan.pdf' }],
      recipients: { contactIds: [] },
    })).toBe(true);

    expect(isStartupSavedUpdateRecord({
      id: 'update-1',
      photos: [{ caption: 'missing durable photo URI' }],
    })).toBe(false);
    expect(isStartupSavedUpdateRecord({
      id: 'update-1',
      documents: [{}],
    })).toBe(false);
    expect(isStartupSavedUpdateRecord({ id: '' })).toBe(false);
  });

  it('preserves supported document and deletion legacy shapes', () => {
    expect(isStartupReferenceDocumentRecord({
      originalFileName: 'schedule.pdf',
      uri: 'file:///schedule.pdf',
    })).toBe(true);
    expect(isStartupReferenceDocumentRecord({
      id: 'cloud-schedule-1',
      name: 'Cloud schedule',
      originalFileName: 'schedule.pdf',
      uri: '',
      storagePath: 'owner/schedules/schedule.pdf',
    })).toBe(true);
    expect(isStartupReferenceDocumentRecord({ name: 'missing identity and file' })).toBe(false);

    expect(isStartupStandaloneProjectDocumentRecord({
      name: 'Uploaded drawing',
      storagePath: 'owner/project/drawing.pdf',
    })).toBe(true);
    expect(isStartupStandaloneProjectDocumentRecord({ name: 'no identity or file' })).toBe(false);

    expect(isStartupDeletedUpdateRecord({ localId: 'legacy-local-id' })).toBe(true);
    expect(isStartupDeletedUpdateRecord({})).toBe(false);
  });

  it('salvages only valid direct and legacy contact rows', () => {
    const direct = {
      contacts: [
        { name: 'Valid PM', email: 'pm@example.com' },
        {},
        'not-a-contact',
      ],
    };
    expect(isStartupContactBook(direct)).toBe(false);
    expect(salvageStartupContactBook(direct)).toEqual({
      value: { contacts: [{ name: 'Valid PM', email: 'pm@example.com' }] },
      isolatedRecordCount: 2,
    });

    const legacy = {
      ProjectA: [{ name: 'Legacy contact', phone: '555-0100' }, null],
      corruptedGroup: 'not-an-array',
    };
    expect(isStartupContactBook(legacy)).toBe(false);
    expect(salvageStartupContactBook(legacy)).toEqual({
      value: { ProjectA: [{ name: 'Legacy contact', phone: '555-0100' }] },
      isolatedRecordCount: 2,
    });
  });

  it('requires a recoverable stable update inside a stored draft', () => {
    expect(isStartupDraftEnvelope({})).toBe(true);
    expect(isStartupDraftEnvelope({
      draft: { id: 'draft-1', notes: 'site note', photos: [] },
      savedAt: '2026-07-18T12:00:00.000Z',
    })).toBe(true);
    expect(isStartupDraftEnvelope({ draft: {} })).toBe(false);
    expect(isStartupDraftEnvelope({ draft: null })).toBe(false);
  });
});
