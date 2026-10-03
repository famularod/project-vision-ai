// Owner answer 3 Oct 2026 (report wording after a lookahead is replaced), on
// the phone's Reports screen: given every saved task and schedule (as App.tsx
// gives them), the written report does not say the replaced lookahead's
// detail tasks were removed, and explains a date that went back to the
// master schedule's. Synthetic data.

const mockDevices = new Map<string, Map<string, string>>();
const mockLocal = () => {
  if (!mockDevices.has('phone')) mockDevices.set('phone', new Map());
  return mockDevices.get('phone') as Map<string, string>;
};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockLocal().get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockLocal().set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockLocal().delete(key);
  }),
  getAllKeys: jest.fn(async () => Array.from(mockLocal().keys())),
  multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockLocal().get(key) ?? null])),
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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
function approveImport(state: State, source: ReferenceDocument, lines: string[]): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead,
  });
  return {
    items: [...merged.additions, ...merged.next],
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
const onF = approveImport({ items: [], documents: [] }, schedule('MASTER F', '2026-09-07T12:00:00.000Z'), [
  'Framing,Alpha,Lot,09/15/2026,09/25/2026,20',
  'Roofing,Alpha,Lot,11/01/2026,11/10/2026,',
]);
const week1 = approveImport(onF, schedule('LOOKAHEAD L1', '2026-09-08T12:00:00.000Z', 'lookahead'), [
  'Framing,Alpha,Lot,09/22/2026,10/02/2026,30',
  'Rebar delivery,Alpha,Lot,09/09/2026,09/10/2026,100',
  'Formwork strip,Alpha,Lot,09/11/2026,09/12/2026,50',
]);
const week2 = approveImport(week1, schedule('LOOKAHEAD L2', '2026-09-15T12:00:00.000Z', 'lookahead'), [
  'Inspections,Alpha,Lot,09/20/2026,09/21/2026,',
]);

describe('owner answer 3 Oct, on the Reports screen: the report after a newer lookahead replaces the old one', () => {
  const draft = {
    id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
    title: 'Alpha update', subject: 'Alpha update', body: '', openingLine: '', closingLine: '',
    executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
    risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
    needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
    generatedAt: '2026-09-08T12:00:00.000Z',
  };
  /** The screen as App.tsx renders it: the tasks shown, every saved task and schedule. `saved: false`: as it was before. */
  const reportsScreen = (state: State, saved: boolean) => (
    <ReportsScreen
      projectName="Alpha"
      reportType="daily_project_update"
      onReportTypeChange={() => undefined}
      availableProjectNames={['Alpha']}
      selectedProjectNames={['Alpha']}
      onToggleProject={() => undefined}
      reportFormat="project_manager"
      onReportFormatChange={() => undefined}
      updates={[]}
      scheduleItems={shown(state)}
      referenceDocuments={state.documents}
      {...(saved ? { knownScheduleItems: state.items, knownScheduleDocuments: state.documents } : {})}
      onSavedUpdates={() => undefined}
      onCopyReport={async () => 'completed'}
      onEmailReport={async () => 'unknown'}
      onTextReport={async () => 'completed'}
      onDownloadWordReport={async () => 'unknown'}
      onOutlookReport={async () => 'unknown'}
    />
  );
  let current: ReturnType<typeof render> | null = null;
  const visit = (state: State, saved = true) => {
    current?.unmount();
    forgetAllReportSessionState();
    current = render(reportsScreen(state, saved));
  };
  const setClock = (iso: string) => jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'],
  });
  const settle = () => act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  const approvable = () =>
    screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
  const sendByCopy = async () => {
    await approvable();
    fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
    await screen.findByRole('button', { name: 'Share Report' }, SLOW);
    fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
    fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
    await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
    await settle();
    await settle();
  };
  const since = async () => {
    await approvable();
    fireEvent.press(screen.getByRole('button', { name: 'Full written report' }));
    const body = (await screen.findByText(/SINCE THE LAST REPORT/, {}, SLOW)).props.children as string;
    return body.slice(body.indexOf('SINCE THE LAST REPORT'), body.indexOf('COMPLETED WORK'));
  };
  beforeEach(() => {
    mockDevices.clear();
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
    jest.useRealTimers();
  });

  it('the written report does not mention the detail tasks, keeps the completed count, and explains the dates', async () => {
    setClock('2026-09-08T15:00:00.000Z');
    visit(week1);
    await sendByCopy();
    setClock('2026-09-15T15:00:00.000Z');
    visit(week2);
    const text = await since();
    expect(text).not.toMatch(/was removed from the current project plan/);
    expect(text).not.toMatch(/Rebar delivery|Formwork strip/);
    expect(text).not.toMatch(/-1 completed/);
    expect(text).toContain('+0 completed; ');
    expect(text).toContain("Framing finish is back to the master schedule's 09/25/2026 (the previous lookahead showed 10/02/2026).");
    expect(text).not.toMatch(/Framing finish changed from/);
  });

  it('without the saved tasks (the screen as it was given before) the report reads as it did', async () => {
    setClock('2026-09-08T15:00:00.000Z');
    visit(week1, false);
    await sendByCopy();
    setClock('2026-09-15T15:00:00.000Z');
    visit(week2, false);
    const text = await since();
    expect(text).toMatch(/was removed from the current project plan/);
    expect(text).toContain('-1 completed; ');
  });
});
