import type { SupabaseClient } from '@supabase/supabase-js';
import { findExactScheduleTaskForCompletionClaim } from '../../services/DAVECompletionVerification';
import {
  bindPIEScheduleImportBatchProvenance,
  dedupeScheduleImportItems,
  type PIEScheduleImportBatch,
} from '../../services/PIEScheduleImportBatch';
import { normalizeMicrosoftProjectPdfRows } from '../../services/PIEScheduleIntelligence';
import {
  scheduleDocumentIsCurrentEverywhere,
  selectAuthoritativeScheduleItems,
} from '../../services/PIEScheduleReconciliation';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
  scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import {
  bindStableScheduleImportItemIds,
  buildScheduleImportSourceIdentity,
} from '../../services/ScheduleImportSourceIdentity';
import {
  activateSharedReferenceDocument,
  scheduleDocumentsAfterActivation,
  scheduleRetirementMessage,
} from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Whole-app audit A5 pass 4 #3 (30 Sep 2026): a revised schedule takes the
// manager's progress when it is imported (on the web, when it is uploaded);
// making it current later only changes which schedule is current, so progress
// recorded in between stayed on the task it hid. Synthetic schedule text only.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

type Row = readonly [name: string, indent: number, start: string, finish: string, percent?: number];
type State = Readonly<{ items: ScheduleItem[]; documents: ReferenceDocument[] }>;
const PROJECT = { id: 'project-alpha', name: 'Alpha Tower' };

function prepare(rows: readonly Row[], version: string, importedAt: string): PIEScheduleImportBatch {
  const text = [
    'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete',
    ...rows.map(([name, indent, start, finish, percent = 0], index) =>
      [index + 1, name, indent, '5 days', start, finish, `${percent}%`].join('\t')),
  ].join('\n');
  const parsed = normalizeMicrosoftProjectPdfRows({
    contents: text, sourceName: `alpha-${version}.pdf`, projects: [PROJECT.name], now: new Date(importedAt),
  });
  const source = buildScheduleImportSourceIdentity({ bytes: new TextEncoder().encode(text), projects: [PROJECT] });
  const document = {
    id: source.documentId, name: `Alpha ${version}`, originalFileName: `alpha-${version}.pdf`, uri: '', category: 'Schedules',
    notes: '', isCurrent: true, importedAt, importBatchId: source.batchId, projectNames: [PROJECT.name], cloudUpdatedAt: `rev-${version}`,
  } as ReferenceDocument;
  return {
    id: source.batchId, kind: 'schedule_file', sourceCount: 1, sourceLabel: document.originalFileName, message: '',
    items: dedupeScheduleImportItems(bindStableScheduleImportItemIds(parsed, source)), documents: [document],
  };
}

function approve(state: State, reviewed: PIEScheduleImportBatch, approvedAt: string): State {
  const batch = bindPIEScheduleImportBatchProvenance(reviewed);
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: batch.items, completionMatch: findExactScheduleTaskForCompletionClaim,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, state.documents, batch.id), mergeCompletion: item => item, approvedAt,
  });
  const documents = scheduleDocumentsAfterApproval({
    documents: state.documents, approvedDocuments: batch.documents, approvedItems: batch.items, updatedAt: approvedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents };
}

const visible = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents });
const shown = (state: State, taskName: string) => visible(state).find(item => item.taskName === taskName)!;
function manage(state: State, taskName: string, percentComplete: number, at: string): State {
  const target = shown(state, taskName);
  return {
    ...state,
    items: state.items.map(item => item.id === target.id ? {
      ...item, percentComplete, status: percentComplete >= 100 ? 'Complete' : 'In Progress',
      progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'PM', updatedAt: at,
    } : item),
  };
}
const byName = (items: readonly ScheduleItem[], taskName: string) => items.find(item => item.taskName === taskName);

const V1: Row[] = [
  ['ALPHA TOWER', 0, '8/3/26', '9/25/26'],
  ['Frame walls', 1, '8/24/26', '8/28/26'],
  ['Pour footings', 1, '8/17/26', '8/21/26'],
  ['Paint', 1, '9/14/26', '9/18/26'],
];
// The revision moves every task; Pour footings it says is done.
const V2: Row[] = [
  ['ALPHA TOWER', 0, '8/3/26', '9/25/26'],
  ['Frame walls', 1, '8/26/26', '9/1/26'],
  ['Pour footings', 1, '8/17/26', '8/20/26', 100],
  ['Paint', 1, '9/16/26', '9/22/26'],
];

describe('Set Active carries progress recorded since the import to the task now shown', () => {
  let v1State = approve({ items: [], documents: [] }, prepare(V1, 'v1', '2026-08-01T12:00:00.000Z'), '2026-08-01T12:00:00.000Z');
  v1State = manage(v1State, 'Frame walls', 40, '2026-08-12T15:00:00.000Z');
  v1State = manage(v1State, 'Pour footings', 40, '2026-08-12T15:00:00.000Z');
  v1State = manage(v1State, 'Paint', 20, '2026-08-12T15:00:00.000Z');
  const v2Batch = prepare(V2, 'v2', '2026-08-31T12:00:00.000Z');
  const v2State = approve(v1State, v2Batch, '2026-09-01T09:00:00.000Z');
  const [v1Doc, v2Doc] = [v1State.documents[0], v2State.documents.find(document => document.id === v2Batch.documents[0].id)!];
  // The owner rolls back to v1, records progress there, then makes v2 current again.
  const rolledBack = { ...v2State, documents: scheduleDocumentsAfterActivation(v1Doc, v2State.documents, 'project') };
  let onV1 = manage(rolledBack, 'Frame walls', 80, '2026-09-10T15:00:00.000Z');
  onV1 = manage(onV1, 'Pour footings', 60, '2026-09-10T15:00:00.000Z');
  onV1 = manage(onV1, 'Paint', 10, '2026-09-10T15:00:00.000Z');
  const reactivated = scheduleDocumentsAfterActivation(v2Doc, onV1.documents, 'project');

  it('the carried copy takes the manager’s newer value, up or down; a file’s higher value is never lowered', () => {
    expect(shown(v2State, 'Frame walls').percentComplete).toBe(40);
    expect(shown(v2State, 'Pour footings').percentComplete).toBe(100);
    expect(shown(rolledBack, 'Frame walls').id).toBe(shown(v1State, 'Frame walls').id);
    // Rolling back carried nothing: the v1 tasks hold what v2 copied from them.
    expect(scheduleProgressCarriedOnActivation({
      items: v2State.items, documentsBefore: v2State.documents, documentsAfter: rolledBack.documents,
    })).toEqual([]);

    const carried = scheduleProgressCarriedOnActivation({
      items: onV1.items, documentsBefore: onV1.documents, documentsAfter: reactivated, now: '2026-09-11T09:00:00.000Z',
    });
    expect(carried.map(item => [item.taskName, item.percentComplete, item.progressConfirmedAt]).sort()).toEqual([
      ['Frame walls', 80, '2026-09-10T15:00:00.000Z'],
      ['Paint', 10, '2026-09-10T15:00:00.000Z'],
    ]);
    // The v2 tasks keep their own dates and ids.
    expect(byName(carried, 'Frame walls')).toMatchObject({ id: shown(v2State, 'Frame walls').id, finishDate: '09/01/2026' });
    // Pour footings: the file said 100% (A5 pass 4 #1); the manager's later 60% on the hidden v1 task does not lower it.
    expect(byName(carried, 'Pour footings')).toBeUndefined();
  });

  it('is what App.tsx activateReferenceDocument does, compiled: the carried tasks are saved and synced', async () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const ts = jest.requireActual('typescript') as typeof import('typescript');
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    const start = app.indexOf('\n  async function activateReferenceDocument(') + 1;
    const end = app.indexOf('\n  function markReferenceDocumentCurrent(', start);
    const scheduleItemsCurrentRef = { current: onV1.items };
    const syncScheduleItemRevision = jest.fn(async () => true);
    const deps: Record<string, unknown> = {
      referenceDocumentsCurrentRef: { current: onV1.documents }, currentReferenceActivationIdsRef: { current: new Set<string>() },
      buildECOSDocumentReadiness: () => ({ canMakeCurrent: true, detail: '' }), canonicalReferenceCategory: () => 'schedule',
      activateSharedReferenceDocument: (input: Parameters<typeof activateSharedReferenceDocument>[0]) => activateSharedReferenceDocument({
        ...input, activate: jest.fn(async () => ({ status: 'activated' as const, documentId: v2Doc.id, updatedAt: 'later', changedCount: 2, message: null })),
      }),
      scheduleRetirementMessage, scheduleDocumentIsCurrentEverywhere,
      getSupabaseClient: () => ({ rpc: jest.fn(async () => ({ data: 'project', error: null })) }) as unknown as SupabaseClient,
      projectDocumentSharedRecordSync: { flush: () => false },
      listReferenceDocuments: async () => ({ ok: true, stubbed: false, data: reactivated }), normalizeReferenceDocuments: (rows: unknown) => rows,
      deletedDAVERecordIds: () => [], operationalSyncTombstonesRef: { current: [] },
      mergeDAVEReferenceDocumentRecoveryRecords: ({ cloud }: { cloud: ReferenceDocument[] }) => cloud,
      reconcileCurrentScheduleDocuments: (documents: ReferenceDocument[]) => documents,
      markReferenceDocumentsAuthorityReady: jest.fn(), setReferenceDocuments: jest.fn(),
      scheduleProgressCarriedOnActivation, scheduleItemsCurrentRef, markScheduleItemsAuthorityReady: jest.fn(), setScheduleItems: jest.fn(),
      syncScheduleItemRevision, advanceScheduleItemSyncGeneration: () => 1,
      Alert: { alert: jest.fn() },
    };
    const js = ts.transpileModule(`module.exports = ${app.slice(start, end).trim()}`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} as unknown };
    new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
    // v2, retired by the rollback, is made current again through the cloud.
    expect(await (mod.exports as (documentId: string) => Promise<boolean>)(v2Doc.id)).toBe(true);
    const frame = shown({ items: scheduleItemsCurrentRef.current, documents: reactivated }, 'Frame walls');
    expect(frame).toMatchObject({ id: shown(v2State, 'Frame walls').id, percentComplete: 80, finishDate: '09/01/2026' });
    expect(syncScheduleItemRevision).toHaveBeenCalledTimes(2);
    expect(syncScheduleItemRevision).toHaveBeenCalledWith(expect.objectContaining({ id: frame.id, percentComplete: 80 }), 1);
  });
});

describe('the web’s Make Current carries progress recorded since the upload', () => {
  const task = (id: string, extra: Partial<ScheduleItem>) => ({
    id, projectName: 'Alpha Tower', locationName: 'Level 1', taskName: 'Hang drywall', startDate: '09/08/2026', finishDate: '09/12/2026',
    milestone: '', owner: '', contractor: '', priority: 'Medium', notes: '', createdAt: '2026-09-01T00:00:00.000Z',
    status: 'In Progress', percentComplete: 40, ...extra,
  }) as ScheduleItem;
  const r1 = task('r1-drywall', {
    importBatchId: 'r1', importedAt: '2026-09-01T00:00:00.000Z',
    progressSource: 'project_manager', progressConfirmedAt: '2026-09-05T00:00:00.000Z', progressConfirmedBy: 'PM',
  });
  // Uploaded 9 Sep with the manager's 40% carried; made current 20 Sep.
  const r2 = task('r2-drywall', {
    importBatchId: 'r2', importedAt: '2026-09-09T00:00:00.000Z', finishDate: '09/15/2026',
    progressSource: 'project_manager', progressConfirmedAt: '2026-09-05T00:00:00.000Z', progressConfirmedBy: 'PM',
  });

  it('shows the 80% recorded on the phone in between, not the 40% copied at upload', () => {
    const phone = { ...r1, percentComplete: 80, progressConfirmedAt: '2026-09-15T00:00:00.000Z' };
    const [carried] = scheduleProgressCarriedToShownTasks({ before: [phone], after: [r2], now: '2026-09-20T00:00:00.000Z' });
    expect(carried).toMatchObject({ id: 'r2-drywall', finishDate: '09/15/2026', percentComplete: 80, progressConfirmedAt: '2026-09-15T00:00:00.000Z' });
    // Nothing recorded since the upload: nothing to save.
    expect(scheduleProgressCarriedToShownTasks({ before: [r1], after: [r2] })).toEqual([]);
    // Only a task the upload paired: another task's progress never moves.
    expect(scheduleProgressCarriedToShownTasks({ before: [{ ...phone, taskName: 'Tape drywall' }], after: [r2] })).toEqual([]);
  });

  it('the provider saves them after Make Current, through the guarded task update', () => {
    const provider = jest.requireActual('fs').readFileSync(
      jest.requireActual('path').resolve(__dirname, '../../components/web-shell/desktop-auth-provider.tsx'), 'utf8') as string;
    const setCurrent = provider.slice(provider.indexOf('const setCurrentSchedule = useCallback'), provider.indexOf('const setCurrentDocument = useCallback'));
    expect(setCurrent).toMatch(/const shownBefore = snapshotRef\.current\?\.scheduleItems \?\? \[\];\s*const scope = await daveWebSupabaseGateway\.setAuthorizedCurrentSchedule/);
    expect(setCurrent).toMatch(/await refreshSnapshotInBackground\(collections\);[\s\S]*scheduleProgressCarriedToShownTasks\(\{\s*before: shownBefore,\s*after: snapshotRef\.current\?\.scheduleItems \?\? \[\],/);
    expect(setCurrent).toContain('if (carried.length > 0) await updateTasks(carried).catch(() => 0);');
  });
});
