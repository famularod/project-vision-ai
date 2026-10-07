// R3 item 1 (open item, 6 Oct 2026), on the phone's Reports screen: the
// report's Project Truth is built by the one recipe the web's Reports page
// uses, with the saved tasks handed on, so a field update the app counted for
// the project by its task's hidden row is in the report's facts, and the two
// read the same facts from the same saved rows. Synthetic data.

const mockLocal = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockLocal.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockLocal.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockLocal.delete(key);
  }),
  getAllKeys: jest.fn(async () => Array.from(mockLocal.keys())),
  multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockLocal.get(key) ?? null])),
}));
jest.mock('../../services/SupabaseService', () => ({
  loadReportSnapshotCloud: jest.fn(async () => ({ ok: true, configured: true, data: null, stubbed: true })),
  saveReportSnapshotCloud: jest.fn(async () => ({ ok: true, configured: true, data: null, stubbed: true })),
}));
let mockAuthority: Record<string, unknown>;
jest.mock('../../providers/PIELiveAuthorityProvider', () => ({
  usePIELiveAuthority: () => mockAuthority,
  useOptionalPIELiveAuthority: () => mockAuthority,
}));
jest.mock('react-native-reanimated', () => ({ getUseOfValueInStyleWarning: () => '' }));
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: (props: Record<string, unknown>) => <View {...props} /> };
});
// The real recipe, with what each caller handed it and what it gave back kept.
const mockBuilt: { input: Record<string, unknown>; truths: unknown[] }[] = [];
jest.mock('../../services/DAVEReportProjectTruths', () => {
  const actual = jest.requireActual('../../services/DAVEReportProjectTruths');
  return {
    ...actual,
    buildDAVEReportProjectTruths: (input: Record<string, unknown>) => {
      const truths = actual.buildDAVEReportProjectTruths(input);
      mockBuilt.push({ input, truths });
      return truths;
    },
  };
});

import { act, render, screen } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import type { DAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleSavedTasksOfProjects } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
function approveImport(state: State, source: ReferenceDocument, lines: string[]): State {
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
const first = approveImport({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [
  'Pour slab,Alpha,Lot,09/15/2026,09/18/2026,0', 'Roofing,Alpha,Lot,11/01/2026,11/10/2026,',
]);
const moved = approveImport(first, schedule('MASTER 2', '2026-09-14T12:00:00.000Z'), [
  'Pour slab,Alpha,Lot,09/22/2026,09/25/2026,0', 'Roofing,Alpha,Lot,11/01/2026,11/10/2026,',
]);
/** Filed on Pour slab's first row before the master moved it, under the project's older name, with no parent kept. */
const onOldRow = {
  id: 'u-old-row', projectName: 'Alpha Tower', date: '2026-09-10T15:00:00.000Z', photos: [], recipients: { contactIds: [] },
  notes: 'Pour slab formwork is set.', scheduleItemId: 'MASTER 1-1', scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
} as unknown as ProjectUpdate;
const onShown = { ...onOldRow, id: 'u-shown', projectName: 'Alpha', scheduleItemId: 'MASTER 1-2', scheduleTaskName: 'Roofing' } as ProjectUpdate;
const UPDATES = [onOldRow, onShown];
const PROJECTS = [{ id: 'project-alpha', name: 'Alpha' }];

/** What App.tsx hands the screen for a daily report (its live authority input in Reports). */
function appProps(state: State) {
  const scope = buildDailyReportAuthorityScope({
    selectedProjectName: 'Alpha', selectedProjectNames: ['Alpha'], projectRecords: PROJECTS as never, updates: UPDATES,
    scheduleItems: shown(state), currentUpdate: null, projectAreas: [], knownScheduleItems: state.items, referenceDocuments: state.documents,
  });
  return {
    updates: scope.updates, scheduleItems: scope.scheduleItems, projectAreas: scope.projectAreas, referenceDocuments: scope.referenceDocuments,
    knownScheduleItems: scheduleSavedTasksOfProjects(state.items, scope.scheduleItems, scope.projectNames) as ScheduleItem[],
    knownScheduleDocuments: state.documents,
  };
}
const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Alpha update', subject: 'Alpha update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-16T12:00:00.000Z',
};
/** A truth word for word, without the one thing each device has its own of: the id the truth is filed under. */
const facts = (truth: DAVEProjectTruth) => JSON.parse(
  JSON.stringify(truth).split(encodeURIComponent(truth.projectId)).join('<project id>').split(JSON.stringify(truth.projectId).slice(1, -1)).join('<project id>'),
);
const updatesOf = (truth: DAVEProjectTruth) => truth.evidence.records.filter(record => record.kind === 'update').map(record => [record.sourceRecordId, record.taskId]).sort();

describe('R3 item 1: the phone\'s Reports screen builds the report\'s facts by the web\'s recipe', () => {
  let current: ReturnType<typeof render> | null = null;
  const settle = () => act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  beforeEach(() => {
    mockLocal.clear();
    mockBuilt.length = 0;
    forgetAllReportSessionState();
    mockAuthority = {
      state: 'ready',
      policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
      reportDraft: draft,
      runtime: { response: { reportDraft: draft } },
      executiveJudgmentRecord: null,
    };
  });
  afterEach(() => {
    current?.unmount();
    current = null;
  });

  it('hands the saved tasks to the recipe, has the update on the hidden row, and reads the web\'s facts', async () => {
    const props = appProps(moved);
    // The app's own scope counted the update on the hidden row for Alpha.
    expect(props.updates.map(update => update.id).sort()).toEqual(['u-old-row', 'u-shown']);
    current = render(
      <ReportsScreen
        projectName="Alpha"
        reportType="daily_project_update"
        onReportTypeChange={() => undefined}
        availableProjectNames={['Alpha']}
        selectedProjectNames={['Alpha']}
        onToggleProject={() => undefined}
        reportFormat="project_manager"
        onReportFormatChange={() => undefined}
        {...props}
        onSavedUpdates={() => undefined}
        onCopyReport={async () => 'completed'}
        onEmailReport={async () => 'unknown'}
        onTextReport={async () => 'completed'}
        onDownloadWordReport={async () => 'unknown'}
        onOutlookReport={async () => 'unknown'}
      />,
    );
    await screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
    await settle();
    expect(mockBuilt.length).toBeGreaterThan(0);
    const phone = mockBuilt[mockBuilt.length - 1];
    expect(phone.input.knownScheduleItems).toBe(props.knownScheduleItems);
    expect(phone.input.knownScheduleDocuments).toBe(props.knownScheduleDocuments);
    const phoneTruth = phone.truths[0] as DAVEProjectTruth;
    expect(phoneTruth.projectId).toBe('report:alpha');
    // R4, first commit: the update on the hidden row is held for the fingerprint's new version (R4 item 4a); until
    // then the screen's facts are scoped as Build 230 scoped them.
    expect(updatesOf(phoneTruth)).toEqual([['u-shown', 'MASTER 1-2']]);

    // The web, from the same saved rows.
    mockBuilt.length = 0;
    const webTruth = buildDAVEWebReportTruths({
      projects: PROJECTS, scheduleItems: shown(moved), knownScheduleItems: moved.items,
      projectUpdates: UPDATES.map(update => ({ id: update.id, updateData: update })),
      referenceDocuments: moved.documents, refreshedAt: phoneTruth.generatedAt,
    } as unknown as DAVEWebReadOnlySnapshot, 'Alpha')[0];
    expect(mockBuilt).toHaveLength(1);
    expect(facts(webTruth)).toEqual(facts(phoneTruth));
  });
});
