import type { DAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  daveReportSnapshotScopeKey,
} from '../../services/DAVEReportSnapshot';

function truth({
  status = 'In Progress',
  percentComplete = 40,
  owner = 'David',
  finishDate = '2026-08-10',
  urgency = 'upcoming',
}: {
  status?: string;
  percentComplete?: number;
  owner?: string | null;
  finishDate?: string | null;
  urgency?: DAVEProjectTruth['schedule'][number]['urgency'];
} = {}): DAVEProjectTruth {
  return {
    projectName: '2321 Compliance Project',
    generatedAt: '2026-07-29T15:00:00.000Z',
    schedule: [{
      taskId: 'paving',
      taskName: 'Place asphalt',
      areaName: 'North Lot',
      owner,
      status,
      percentComplete,
      finishDate,
      urgency,
      approvalStatus: null,
      estimatedScheduleImpactDays: null,
    }],
  } as unknown as DAVEProjectTruth;
}

function snapshot(projectTruth: DAVEProjectTruth, capturedAt: string) {
  return buildDAVEReportSnapshot({
    truths: [projectTruth],
    scopeKey: daveReportSnapshotScopeKey([projectTruth.projectName]),
    sourceFingerprint: capturedAt,
    capturedAt,
  });
}

describe('DAVE approved-report snapshots', () => {
  it('uses a stable scope key regardless of project selection order', () => {
    expect(daveReportSnapshotScopeKey(['2375 Project', '2321 Project'])).toBe(
      daveReportSnapshotScopeKey(['2321 Project', '2375 Project']),
    );
  });

  it('establishes a baseline when no approved snapshot exists', () => {
    const comparison = compareDAVEReportSnapshots({
      current: snapshot(truth(), '2026-07-29T15:00:00.000Z'),
      previous: null,
    });

    expect(comparison).toMatchObject({
      basis: 'current_snapshot',
      completeDelta: 0,
      openDelta: 0,
      overdueDelta: 0,
      changes: [],
    });
  });

  it('reports completion, ownership, finish-date, and overdue movement', () => {
    const previous = snapshot(
      truth(),
      '2026-07-22T15:00:00.000Z',
    );
    const current = snapshot(
      truth({
        status: 'Complete',
        percentComplete: 100,
        owner: 'Alex',
        finishDate: '2026-08-12',
        urgency: 'overdue',
      }),
      '2026-07-29T15:00:00.000Z',
    );

    const comparison = compareDAVEReportSnapshots({ current, previous });

    expect(comparison).toMatchObject({
      basis: 'previous_approved_report',
      completeDelta: 1,
      openDelta: -1,
      overdueDelta: 0,
    });
    expect(comparison.changes.map(change => change.kind)).toEqual(
      expect.arrayContaining(['completed', 'status', 'finish_date', 'owner']),
    );
  });

  it('reports a completed task that is reopened', () => {
    const previous = snapshot(
      truth({ status: 'Complete', percentComplete: 100 }),
      '2026-07-22T15:00:00.000Z',
    );
    const current = snapshot(
      truth({ status: 'In Progress', percentComplete: 75 }),
      '2026-07-29T15:00:00.000Z',
    );

    const comparison = compareDAVEReportSnapshots({ current, previous });

    expect(comparison.completeDelta).toBe(-1);
    expect(comparison.openDelta).toBe(1);
    expect(comparison.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'reopened',
        summary: 'Place asphalt was reopened at 75% complete.',
      }),
    ]));
  });
});
