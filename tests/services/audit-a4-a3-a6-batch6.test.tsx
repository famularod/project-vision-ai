jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

import { act, renderHook } from '@testing-library/react-native';
import { useCommittedText } from '../../hooks/use-committed-text';
import type { DAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  daveReportSnapshotScopeKey,
} from '../../services/DAVEReportSnapshot';
import { sameFieldUpdateSyncGeneration } from '../../services/FieldUpdateSyncGeneration';
import { projectDeletionTakesUpdate } from '../../services/ProjectDeletionTransaction';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
const app = read('App.tsx');

// Whole-app audit (30 Sep 2026): A4 pass 5, A3 pass 2 and A6 pass 5 findings traced to earlier batches.
describe('one rule for what a project deletion takes (A4 pass 5 L6, A3 pass 2 L4)', () => {
  const scheduleItems = [{ id: 'task-live', projectName: 'Target' }];
  it('takes an update kept as evidence for a deleted task of the project, explicit parent first', () => {
    const takes = (update: Record<string, unknown>) =>
      projectDeletionTakesUpdate({ update: update as never, projectName: 'Target', scheduleItems });
    expect(takes({ projectName: 'Target', scheduleItemId: 'task-live' })).toBe(true);
    expect(takes({ projectName: 'Target', scheduleItemId: 'task-gone' })).toBe(true);
    expect(takes({ projectName: 'Area label', scheduleProjectName: 'Target', scheduleItemId: 'task-gone' })).toBe(true);
    expect(takes({ projectName: 'Target', scheduleProjectName: 'Other', scheduleItemId: 'task-gone' })).toBe(false);
    expect(takes({ projectName: 'Other', scheduleItemId: 'task-gone' })).toBe(false);
    expect(takes({ projectName: 'Target' })).toBe(true);
  });

  it('the App’s file cleanup list and its open-draft check use it', () => {
    expect(app).toMatch(/const removedUpdates = savedUpdatesRef\.current\.filter\(update =>\n\s+projectDeletionTakesUpdate\(\{/);
    expect(app).toMatch(/\.\.\.\(projectDeletionTakesUpdate\(\{\n\s+update: draftRef\.current,/);
    expect(app).toMatch(/draftBelongsToProject: projectDeletionTakesUpdate\(\{\n\s+update: draftRef\.current,/);
  });
});

describe('the area name commits only what was typed (A3 pass 2 L2, L3)', () => {
  const render = (initial: { name?: string; id?: string }) => {
    const onCommit = jest.fn();
    const hook = renderHook(
      (props: { name?: string; id?: string }) => useCommittedText(props.name, props.id, onCommit),
      { initialProps: initial },
    );
    return { hook, onCommit };
  };

  it('until typed, the field follows the saved name and closing writes nothing', () => {
    const { hook, onCommit } = render({ name: 'Gate', id: 'area-1' });
    hook.rerender({ name: 'Gate 3', id: 'area-1' });
    expect(hook.result.current.text).toBe('Gate 3');
    act(() => hook.result.current.commit());
    expect(onCommit).not.toHaveBeenCalled();
    // Typed, it commits once and then shows the saved value again.
    act(() => hook.result.current.setText('Gate 3 East'));
    act(() => hook.result.current.commit());
    expect(onCommit).toHaveBeenCalledWith('Gate 3 East');
    act(() => hook.result.current.commit());
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Delete commits the typed name first, so a cancelled delete keeps it', () => {
    expect(app).toMatch(/label="Delete"\n\s+icon="trash-outline"\n\s+onPress=\{\(\) => \{\n\s+areaName\.commit\(\);[^\n]*\n\s+onDelete\(\);\n\s+\}\}/);
  });
});

describe('startup (A7 pass 3 L3)', () => {
  it('a queue that cannot be read does not block the project list', () => {
    expect(app).toMatch(/isStartupProjectName,\n\s+\),\n(?:\s*\/\/.*\n)*\s+getOfflineQueue\(\)\.catch\(\(\) => \[\]\),\n\s+\]\);/);
  });
});

describe('the sync generation ignores cloud-derived photo fields and reads null as missing (A4 pass 5 L1)', () => {
  const photo = (extra: Record<string, unknown> = {}) => ({ id: 'p1', uri: 'file:///p1.jpg', caption: 'Pour', ...extra });
  const update = (photos: unknown[], extra: Record<string, unknown> = {}) => ({ id: 'u1', notes: 'Slab', photos, ...extra });

  it('a relaunched copy with null cloud fields is the queued copy’s generation', () => {
    const relaunched = update([photo({
      cloudStoragePath: null, cloudRecoveredAt: null, cloudRecoveryStatus: null,
      cloudSignedUrlExpiresAt: null, cloudPreviewUri: null, cloudPreviewSignedUrlExpiresAt: null,
    })], { archivedAt: null });
    const queued = update([photo()]);
    expect(sameFieldUpdateSyncGeneration(relaunched, queued)).toBe(true);
    // A relocation reset the recovery status on the queued copy only.
    expect(sameFieldUpdateSyncGeneration(update([photo({ cloudRecoveryStatus: 'unavailable' })]), update([photo({ cloudRecoveryStatus: null })]))).toBe(true);
  });

  it('a real edit is still a new generation', () => {
    expect(sameFieldUpdateSyncGeneration(update([photo()]), update([photo({ caption: 'Pour 2' })]))).toBe(false);
    expect(sameFieldUpdateSyncGeneration(update([photo()]), update([photo()], { notes: 'Slab poured' }))).toBe(false);
    expect(sameFieldUpdateSyncGeneration(update([photo()], { notes: 'Slab' }), update([photo()], { notes: null }))).toBe(false);
  });
});

describe('a conflict’s sync status is never read from its sentence (A4 pass 5 L3)', () => {
  it('sets the category explicitly', () => {
    const sync = read('services/SyncService.ts');
    expect(sync).toMatch(/failureCategory: isSyncFailureCategory\(remainingItem\?\.lastFailureCategory\)\n\s+\? remainingItem\.lastFailureCategory\n\s+: currentConflict \|\| itemOutcome === 'failed' \? 'unknown' : null,/);
  });
});

describe('reports (A6 pass 5)', () => {
  const truth = (finishDate: string, status = 'In Progress', percentComplete = 40) => ({
    projectName: '2321 Compliance Project',
    generatedAt: '2026-09-30T15:00:00.000Z',
    schedule: [{
      taskId: 'footings', taskName: 'Excavate footings', areaName: 'North Lot', owner: 'David',
      status, percentComplete, finishDate, urgency: 'upcoming',
      approvalStatus: null, estimatedScheduleImpactDays: null,
    }],
  }) as unknown as DAVEProjectTruth;
  const snapshot = (projectTruth: DAVEProjectTruth, capturedAt: string) => buildDAVEReportSnapshot({
    truths: [projectTruth],
    scopeKey: daveReportSnapshotScopeKey([projectTruth.projectName]),
    sourceFingerprint: capturedAt,
    capturedAt,
  });

  it('a finish date saved in the older form is not a change; a different day still is', () => {
    const unchanged = compareDAVEReportSnapshots({
      previous: snapshot(truth('Jul 24, 2026'), '2026-09-22T15:00:00.000Z'),
      current: snapshot(truth('07/24/2026', 'Complete', 100), '2026-09-30T15:00:00.000Z'),
    });
    expect(unchanged.changes.map(change => change.kind)).not.toContain('finish_date');
    expect(unchanged.changes.map(change => change.kind)).toContain('completed');
    const moved = compareDAVEReportSnapshots({
      previous: snapshot(truth('Jul 24, 2026'), '2026-09-22T15:00:00.000Z'),
      current: snapshot(truth('07/25/2026'), '2026-09-30T15:00:00.000Z'),
    });
    expect(moved.changes.map(change => change.kind)).toContain('finish_date');
  });

  it('an approval-save error stays until the next approval, and the saved snapshot is the ref at once', () => {
    const screen = read('screens/ReportsScreen.tsx');
    expect(screen).toContain("communicationError={[snapshotSaveError, communicationError].filter(Boolean).join(' ')}");
    expect(screen).toMatch(/setSnapshotSaveError\(\n\s+'The report is approved, but its reporting-period snapshot could not be saved on this device\.',/);
    expect(screen).toMatch(/previousReportSnapshotRef\.current = snapshotToSave;\n\s+setPreviousReportSnapshot\(snapshotToSave\);/);
    expect(screen).toMatch(/previousReportSnapshotRef\.current = delivered;\n\s+setPreviousReportSnapshot\(delivered\);/);
  });

  it('an executive report attaches no photos for the owner’s own "see image" note', () => {
    expect(app).toContain("return reportFormat !== 'executive' && /\\bSee Images?\\s+\\d/i.test(report.body);");
  });
});
