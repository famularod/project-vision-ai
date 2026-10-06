/**
 * Settings › Sync Now, run the way the app runs it (whole-app audit A6 pass
 * 11 L1, 30 Sep 2026): AdminScreen's own Sync Now button, its download
 * (`synchronizeLocalData`, as the test file mocks it: no network here), and
 * App.tsx's own onApplyCloudRecovery closure, compiled from App.tsx, applying
 * what came down to the device's tasks. Pass 10 stood in for Sync Now by
 * recording a download directly, which hid that Sync Now recorded none.
 *
 * The test file mocks what AdminScreen reads from SupabaseService and
 * SyncService (as audit-a8-p2-admin-sync does), with `synchronizeLocalData`
 * returning `syncNowResult`.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AdminScreen } from '../../screens/AdminScreen';
import { isDAVESafeCloudScheduleRecord, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { deletedDAVERecordIds } from '../../services/DAVESyncTombstones';
import { recordScheduleCloudPull } from '../../services/ScheduleCloudPull';
import { scheduleItemsWithPendingEditsOverCloud } from '../../services/ScheduleItemQueueRevision';
import type { FullSyncResult } from '../../services/SyncService';
import type { ScheduleItem } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');

/** The brace-matched block of App.tsx that opens at the end of `marker`. */
function appBlockAfter(marker: string): string {
  const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
  const start = app.indexOf(marker);
  if (start < 0) throw new Error(`App.tsx has no ${marker}`);
  const open = start + marker.length - 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(open, index + 1);
    }
  }
  throw new Error('unbalanced block');
}

type Recovered = Parameters<Parameters<typeof AdminScreen>[0]['onApplyCloudRecovery']>[0];

/**
 * App.tsx's onApplyCloudRecovery, applying to `device`'s tasks. Only the
 * task branch runs here: the other collections come back failed (skipped).
 */
export function appCloudRecovery(device: { scheduleItems: ScheduleItem[] }): (recovered: Recovered) => void {
  const js = ts.transpileModule(`module.exports = recovered => ${appBlockAfter('onApplyCloudRecovery={recovered => {')}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const deps: Record<string, unknown> = {
    // The tasks below are already in their stored form.
    normalizeScheduleItems: (items: unknown[]) => items,
    migrateLegacyScheduleItem: (item: ScheduleItem) => item,
    isDAVESafeCloudScheduleRecord,
    recoverDAVEScheduleRecords,
    scheduleItemsWithPendingEditsOverCloud, // a task edit waiting with its base, over the cloud's row (owner answer Q28)
    deletedDAVERecordIds,
    recordScheduleCloudPull,
    setScheduleItems: (next: (previous: ScheduleItem[]) => ScheduleItem[]) => {
      device.scheduleItems = next(device.scheduleItems);
    },
    markScheduleItemsAuthorityReady: () => undefined,
  };
  const mod = { exports: {} as (recovered: Recovered) => void };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}

const NOT_IN_THIS_TEST = 'Not part of this test.';

/**
 * What `synchronizeLocalData` hands back when every task and the deletion
 * history came down (`deletionHistory: 'verified'`), or when the deletion
 * history could not be verified, so the tasks are not applied.
 */
export function syncNowResult(
  scheduleItems: ScheduleItem[],
  deletionHistory: 'verified' | 'unverified' = 'verified',
): FullSyncResult {
  const scheduleError = deletionHistory === 'verified' ? null : 'Deletion history could not be verified.';
  return {
    configured: true,
    connected: true,
    downloadStatus: scheduleError ? 'partial' : 'complete',
    uploaded: 0,
    downloaded: scheduleError ? 0 : scheduleItems.length,
    queued: 0,
    conflicts: 0,
    cloudProjectCount: 1,
    lastSyncAt: new Date().toISOString(),
    errors: scheduleError ? [scheduleError] : [],
    missingPhotos: [],
    details: {
      queuedUploads: 0, projectsUploaded: 0, updatesUploaded: 0, photosUploaded: 0, areasUploaded: 0,
      schedulesUploaded: 0, documentsUploaded: 0, cloudProjectsDownloaded: 1, cloudUpdatesDownloaded: 0,
      cloudAreasDownloaded: 0, cloudSchedulesDownloaded: scheduleError ? 0 : scheduleItems.length, cloudDocumentsDownloaded: 0,
    },
    recovered: {
      projects: [],
      updates: [],
      projectAreas: [],
      scheduleItems: scheduleError ? [] : scheduleItems,
      referenceDocuments: [],
      tombstones: [],
      collectionErrors: {
        projects: NOT_IN_THIS_TEST,
        updates: NOT_IN_THIS_TEST,
        projectAreas: NOT_IN_THIS_TEST,
        scheduleItems: scheduleError,
        referenceDocuments: NOT_IN_THIS_TEST,
      },
    },
  };
}

/**
 * Opens Settings on `device`, presses Sync Now, waits for it to finish, and
 * leaves Settings. `whileItRuns` runs after the press, before the wait (the
 * test's `synchronizeLocalData` can hold its download until it is done).
 */
export async function pressSettingsSyncNow(
  device: { scheduleItems: ScheduleItem[] },
  whileItRuns?: () => Promise<void>,
): Promise<void> {
  const settings = render(
    <AdminScreen
      localProjects={['Tower']}
      savedUpdates={[]}
      projectAreas={[]}
      scheduleItems={device.scheduleItems}
      referenceDocuments={[]}
      displayName="David"
      onDisplayNameChange={() => undefined}
      onBack={() => undefined}
      onDiagnostics={() => undefined}
      onBackup={() => undefined}
      onRestore={() => undefined}
      onAddArea={() => true}
      onUpdateArea={() => undefined}
      onDeleteArea={() => undefined}
      onUseCurrentLocationForArea={() => undefined}
      onRemoveMissingPhotos={async () => undefined}
      onRetryUpdateSync={async () => ({ status: 'sent' }) as never}
      onRetryDocumentUploads={async () => ({ attempted: 0, uploaded: 0, remaining: 0 })}
      failedDocumentCount={0}
      onApplyCloudConflictUpdate={() => undefined}
      onApplyCloudConflictScheduleItem={() => undefined}
      onApplyCloudRecovery={appCloudRecovery(device)}
      onSaveCaptureMemory={async () => undefined}
    />,
  );
  const syncNow = await settings.findByText('Sync Now');
  await act(async () => {
    fireEvent.press(syncNow);
  });
  if (whileItRuns) await whileItRuns();
  await waitFor(() => expect(settings.queryByText('Syncing…')).toBeNull(), { timeout: 30_000 });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  settings.unmount();
}
