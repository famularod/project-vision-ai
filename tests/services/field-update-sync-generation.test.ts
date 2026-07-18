import {
  fieldUpdateSyncGeneration,
  reconcileFieldUpdateSyncResult,
} from '../../services/FieldUpdateSyncGeneration';

type Update = {
  id: string;
  projectName: string;
  notes: string;
  photos: Array<{ id: string; uri: string }>;
  sendAttempts: number;
  lastSendAttemptAt: string;
  status?: string;
  syncDiagnostics?: { result: string };
  deleteDiagnostics?: { deletedAt: string };
  workflowTimestamps?: { sendTappedAt?: string; sendResolvedAt?: string };
};

const queued: Update = {
  id: 'update-1',
  projectName: 'Project A',
  notes: 'Original field observation',
  photos: [{ id: 'photo-1', uri: 'file:///photo.jpg' }],
  sendAttempts: 1,
  lastSendAttemptAt: '2026-07-18T10:00:00.000Z',
  status: 'queued',
  workflowTimestamps: { sendTappedAt: '2026-07-18T10:00:00.000Z' },
};

describe('field update sync generation', () => {
  it('ignores transport-only completion metadata', () => {
    const completed: Update = {
      ...queued,
      status: 'sent',
      syncDiagnostics: { result: 'success' },
      deleteDiagnostics: { deletedAt: 'transport-only' },
      workflowTimestamps: {
        ...queued.workflowTimestamps,
        sendResolvedAt: '2026-07-18T10:00:05.000Z',
      },
    };

    expect(fieldUpdateSyncGeneration(completed)).toBe(
      fieldUpdateSyncGeneration(queued),
    );
  });

  it.each([
    [{ notes: 'Newer edit' }, 'notes'],
    [{ photos: [] }, 'photos'],
    [{ sendAttempts: 2 }, 'retry generation'],
    [{ lastSendAttemptAt: '2026-07-18T10:01:00.000Z' }, 'retry timestamp'],
  ])('changes when content changes (%s)', (change, _label) => {
    expect(fieldUpdateSyncGeneration({ ...queued, ...change })).not.toBe(
      fieldUpdateSyncGeneration(queued),
    );
  });

  it('does not let an old result overwrite a newer edit', () => {
    const newer = { ...queued, notes: 'Corrected while sync was running' };
    const staleResult = { ...queued, status: 'sent' };
    const result = reconcileFieldUpdateSyncResult([newer], queued, staleResult);

    expect(result.applied).toBe(false);
    expect(result.current).toEqual(newer);
    expect(result.updates).toEqual([newer]);
  });

  it('does not recreate a record deleted while sync was running', () => {
    const result = reconcileFieldUpdateSyncResult([], queued, {
      ...queued,
      status: 'sent',
    });

    expect(result).toEqual({ updates: [], applied: false, current: null });
  });

  it('applies the result to the exact generation', () => {
    const sent = { ...queued, status: 'sent' };
    const other = { ...queued, id: 'update-2' };
    const result = reconcileFieldUpdateSyncResult([other, queued], queued, sent);

    expect(result.applied).toBe(true);
    expect(result.current).toEqual(sent);
    expect(result.updates).toEqual([other, sent]);
  });
});
