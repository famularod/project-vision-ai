// Review of D1 (independent review P5, pass 1), L10, on the phone's Reports
// screen: the one place shared documents are handed to the report recipe.
// An archived document (owner answer Q44) is not handed on. With nothing
// archived the recipe gets the very list the app gave the screen, so the
// report's fingerprint is exactly what it was. Synthetic data.

const mockLocal = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockLocal.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockLocal.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockLocal.delete(key); }),
    getAllKeys: jest.fn(async () => Array.from(mockLocal.keys())),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockLocal.get(key) ?? null])),
  },
  getItem: jest.fn(async (key: string) => mockLocal.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockLocal.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockLocal.delete(key); }),
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
// The real recipe, with what the screen handed it and what it gave back kept.
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
import { buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import type { DAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { noteSharedDocumentArchiveLiveRow, openSharedDocumentArchive, sharedDocumentArchiveSettled } from '../../services/SharedDocumentArchive';
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;

const shared = (id: string, more: Partial<ReferenceDocument>): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', mimeType: 'application/pdf', category: 'Drawings', notes: '', isCurrent: true,
  importedAt: '2026-10-01T10:00:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: null, ...more,
} as ReferenceDocument);
const DOCUMENTS = [
  shared('drawing-a101', { name: 'A-101 Site plan' }),
  shared('contract', { name: 'Site contract', category: 'Contract' }),
];
const UPDATES = [{
  id: 'u1', projectName: 'Alpha', date: '2026-10-05T15:00:00.000Z', photos: [], recipients: { contactIds: [] }, notes: 'Survey stakes set.', selectedAreaName: 'Lot',
}] as unknown as ProjectUpdate[];
const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Alpha update', subject: 'Alpha update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-10-06T12:00:00.000Z',
};
const idsIn = (truths: unknown[]) => JSON.stringify(truths).match(/"(drawing-a101|contract)"/g) ?? [];

let owners = 0;
let current: ReturnType<typeof render> | null = null;
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); await sharedDocumentArchiveSettled(); });

async function openReports() {
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
      updates={UPDATES}
      scheduleItems={[] as ScheduleItem[]}
      knownScheduleItems={[] as ScheduleItem[]}
      knownScheduleDocuments={DOCUMENTS}
      projectAreas={[]}
      referenceDocuments={DOCUMENTS}
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
  return mockBuilt[mockBuilt.length - 1];
}

describe('review of D1, L10: what the Reports screen hands the report recipe', () => {
  let owner = 'owner-0';
  beforeEach(async () => {
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
    owners += 1;
    owner = `owner-${owners}`;
    await openSharedDocumentArchive(owner);
  });
  afterEach(() => {
    current?.unmount();
    current = null;
  });

  it('with nothing archived: the very list the app gave the screen, so the report\'s fingerprint has not moved', async () => {
    const built = await openReports();
    expect(built.input.referenceDocuments).toBe(DOCUMENTS);
    expect(idsIn(built.truths)).toEqual(expect.arrayContaining(['"drawing-a101"', '"contract"']));
    // The same recipe fed that list directly, as the screen fed it before this change.
    const { buildDAVEReportProjectTruths } = jest.requireActual('../../services/DAVEReportProjectTruths');
    const before = buildDAVEReportSourceFingerprint(buildDAVEReportProjectTruths({ ...built.input, referenceDocuments: DOCUMENTS }) as DAVEProjectTruth[]);
    expect(buildDAVEReportSourceFingerprint(built.truths as DAVEProjectTruth[])).toBe(before);
  });

  it('an archived document is not handed on, and the report follows when it is archived or restored while Reports is open', async () => {
    await noteSharedDocumentArchiveLiveRow({ ownerId: owner, eventType: 'UPDATE', newRow: { id: 'contract', owner_id: owner, archived_at: '2026-10-06T10:00:00.000Z' }, oldRow: null });
    const built = await openReports();
    expect((built.input.referenceDocuments as ReferenceDocument[]).map(document => document.id)).toEqual(['drawing-a101']);
    expect(idsIn(built.truths)).not.toContain('"contract"');
    expect(idsIn(built.truths)).toContain('"drawing-a101"');

    // Restored on another device while the screen is open.
    await act(async () => {
      await noteSharedDocumentArchiveLiveRow({ ownerId: owner, eventType: 'UPDATE', newRow: { id: 'contract', owner_id: owner, archived_at: null }, oldRow: null });
    });
    await settle();
    expect(mockBuilt[mockBuilt.length - 1].input.referenceDocuments).toBe(DOCUMENTS);
    expect(idsIn(mockBuilt[mockBuilt.length - 1].truths)).toContain('"contract"');
  });
});
