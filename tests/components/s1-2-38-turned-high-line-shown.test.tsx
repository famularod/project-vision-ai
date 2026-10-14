/**
 * Open item 2.38 (13 Oct 2026), on the screens: the line naming the tasks a newer schedule turned High is shown where
 * he approved it. The phone's and iPad's import review (ScheduleImportFlow: the line App.tsx's approval resolves
 * with, under "Add Schedule or Task", until the next review opens); the desktop's upload notice (the line the upload
 * resolves with) and its Make Current notice (the line the provider kept for that schedule). The records are in
 * tests/services/s1-2-38-schedule-names-tasks-it-turned-high.test.ts. Synthetic data; the desktop harness is that of
 * owner-answer-q15-web-make-current.test.tsx and b232-10b-desktop-upload-review-says-which-projects.test.tsx.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useEffect, useRef, useState } from 'react';

import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot, DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import type { PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LinearGradient: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children) };
});
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/documents',
  useRouter: () => ({ setParams: jest.fn() }),
}));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name',
  formatVitruviusDesktopGreeting: () => 'Good morning',
  readVitruviusDesktopDisplayName: () => 'Manager',
  writeVitruviusDesktopDisplayName: (value: string) => value.trim(),
}));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({
  desktopFieldNoteDataSource: { list: jest.fn(async () => []), save: jest.fn(), update: jest.fn() },
}));
jest.mock('../../services/ECOSWebDocumentExtraction', () => ({
  ...jest.requireActual('../../services/ECOSWebDocumentExtraction'),
  extractECOSWebDocument: jest.fn(async ({ file }: { file: { text: string } }) => ({
    extractedText: file.text, extractedPages: [], extractionStatus: 'complete', extractionMethod: 'text', sourcePageCount: 1, searchablePageCount: 1,
  })),
}));
jest.mock('../../services/DAVEWebScheduleActivation', () => ({
  daveWebScheduleRetirementCheck: jest.fn(async () => ({ ok: true, effects: [], message: '' })),
}));

const LINE = 'This schedule turned 2 tasks High: Framing (Lot) and Roof (Lot). To set one back, open it and change its priority.';

const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot: null as DAVEWebReadOnlySnapshot | null,
  freshness: { status: 'connected', lastSuccessfulRefreshAt: '2026-10-11T12:00:00.000Z', lastAttemptAt: '2026-10-11T12:00:00.000Z', consecutiveFailures: 0 },
  message: null,
  refreshSnapshot: jest.fn(async () => true),
  setCurrentSchedule: jest.fn(async () => 'project'),
  takeScheduleTurnedHighLine: jest.fn((_documentId: string): string | null => null),
  setCurrentDocument: jest.fn(async () => undefined),
  updateDocument: jest.fn(async () => undefined),
  deleteDocument: jest.fn(),
  uploadDocument: jest.fn(async (_prepared: DAVEWebPreparedUpload): Promise<string | null> => null),
  getArtifactUrl: jest.fn(),
  loadDocumentCoverageSummary: jest.fn(async () => { throw new Error('offline'); }),
  loadDocumentProof: jest.fn(),
  enqueueDocumentPreparation: jest.fn(async () => undefined),
};
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({ useDesktopAuth: () => mockAuth }));

jest.setTimeout(60_000);

describe('2.38 on the phone and iPad: the import review shows the line its approval resolves with', () => {
  const batch = (id: string): PIEScheduleImportBatch => ({
    id, kind: 'schedule_file', sourceCount: 1, sourceLabel: `${id}.csv`, message: 'One activity extracted.', documents: [],
    items: [{
      id: `${id}-1`, taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/01/2026', finishDate: '10/11/2026',
      milestone: '', owner: 'David', contractor: '', durationDays: 1, percentComplete: 0, priority: 'High', status: 'Not Started', notes: '',
      createdAt: '2026-10-11T12:00:00.000Z',
    }],
  } as unknown as PIEScheduleImportBatch);
  /** As App.tsx hands it a reviewed file (the card's Import This Schedule): the batch is taken once, then cleared. */
  function Flow({ onApprove, incoming }: { onApprove: jest.Mock; incoming: PIEScheduleImportBatch | null }) {
    const [batchIn, setBatchIn] = useState(incoming);
    const shown = useRef(incoming); // a new file handed over (rerender), not the one already taken
    useEffect(() => { if (incoming !== shown.current) { shown.current = incoming; setBatchIn(incoming); } }, [incoming]);
    return (
      <ScheduleImportFlow
        screenshotImportAvailable={false}
        onImportFile={jest.fn(() => Promise.resolve(null))}
        onImportScreenshots={jest.fn(() => Promise.resolve(null))}
        onAddManually={jest.fn()}
        onApprove={onApprove}
        onCancel={jest.fn()}
        incomingBatch={batchIn}
        onIncomingBatchConsumed={() => setBatchIn(null)}
      />
    );
  }
  const renderFlow = (onApprove: jest.Mock, incoming: PIEScheduleImportBatch | null) => render(<Flow onApprove={onApprove} incoming={incoming} />);

  it('Accept All: the line is under "Add Schedule or Task" once the review closes; the next review clears it', async () => {
    const onApprove = jest.fn(async () => LINE);
    const view = renderFlow(onApprove, batch('MASTER G'));
    expect(view.queryByText(LINE)).toBeNull();
    await act(async () => { fireEvent.press(await view.findByText('Accept All (1)')); });
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(await view.findByText(LINE)).toBeTruthy();
    // It stays while he looks at the tasks; the next review that opens clears it.
    view.rerender(<Flow onApprove={onApprove} incoming={batch('MASTER H')} />);
    await waitFor(() => expect(view.queryByText(LINE)).toBeNull());
    expect(await view.findByText('Accept All (1)')).toBeTruthy();
  });

  it('an approval that turned nothing High (null, or a caller that resolves with nothing) shows no line', async () => {
    for (const answer of [null, undefined]) {
      const view = renderFlow(jest.fn(async () => answer), batch('MASTER K'));
      await act(async () => { fireEvent.press(await view.findByText('Accept All (1)')); });
      expect(view.queryByText(/^This schedule turned/)).toBeNull();
      view.unmount();
    }
  });
});

function scheduleDocument(id: string, extra: Partial<DAVEWebReferenceDocument>): DAVEWebReferenceDocument {
  return {
    id, name: id, originalFileName: `${id}.csv`, uri: '', mimeType: 'text/csv', category: 'Schedules', notes: '', isCurrent: false,
    importedAt: '2026-10-11T12:00:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
    cloudUpdatedAt: '2026-10-11T12:00:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 2, ...extra,
  };
}
function task(id: string, finishDate: string): DAVEWebScheduleItem {
  return {
    id, itemType: 'Task', taskName: `Task ${id}`, projectId: null, projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot',
    startDate: '10/01/2026', finishDate, milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started',
    notes: '', nextAction: '', importedFrom: 'MASTER F.csv', importBatchId: 'batch-MASTER F', importedAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z', cloudUpdatedAt: '2026-10-11T12:00:00.000Z',
  } as DAVEWebScheduleItem;
}
const F = scheduleDocument('MASTER F', { isCurrent: true, importedAt: '2026-06-01T12:00:00.000Z' });
const G = scheduleDocument('MASTER G', {});

describe('2.38 on the desktop', () => {
  beforeAll(() => {
    type TestWindow = { addEventListener?: jest.Mock; removeEventListener?: jest.Mock };
    const root = globalThis as unknown as { window?: unknown };
    const browserWindow = (root.window ?? {}) as TestWindow;
    root.window = browserWindow;
    browserWindow.addEventListener = jest.fn();
    browserWindow.removeEventListener = jest.fn();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    const tasks = [task('a1', '10/11/2026'), task('a2', '11/21/2026')];
    mockAuth.snapshot = {
      projects: [{ id: 'alpha', name: 'Alpha' } as DAVEWebReadOnlySnapshot['projects'][number]],
      scheduleItems: tasks, knownScheduleItems: tasks, projectUpdates: [], referenceDocuments: [F, G], refreshedAt: '2026-10-11T12:00:00.000Z',
    } as DAVEWebReadOnlySnapshot;
  });

  it('Make Current Schedule: the notice ends with the line the provider kept for that schedule', async () => {
    mockAuth.takeScheduleTurnedHighLine.mockImplementationOnce(documentId => (documentId === 'MASTER G' ? LINE : null));
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    fireEvent.press(screen.getByText('Make Current Schedule'));
    expect(await screen.findByText(`“MASTER G” is now the current schedule for Alpha. Earlier schedules remain available as history. ${LINE}`)).toBeTruthy();
    expect(mockAuth.takeScheduleTurnedHighLine).toHaveBeenCalledWith('MASTER G');
  });

  it('Make Current Schedule that turned nothing High: the notice as before', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    fireEvent.press(screen.getByText('Make Current Schedule'));
    expect(await screen.findByText('“MASTER G” is now the current schedule for Alpha. Earlier schedules remain available as history.')).toBeTruthy();
  });

  it('the upload of a full schedule: the notice ends with the line the upload resolves with', async () => {
    mockAuth.uploadDocument.mockImplementationOnce(async () => LINE);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    fireEvent.press(screen.getByLabelText('Add Project Documents'));
    const text = ['Task,Project,Area,Start,Finish,Percent Complete', 'Task a1,Alpha,Lot,10/01/2026,10/11/2026,', 'Task a2,Alpha,Lot,10/01/2026,11/21/2026,'].join('\n');
    const bytes = new TextEncoder().encode(text);
    const file = { name: 'MASTER H.csv', type: 'text/csv', size: bytes.byteLength, text, arrayBuffer: async () => bytes.buffer.slice(0) };
    const input = screen.UNSAFE_getByProps({ 'aria-label': 'Choose file from this computer' });
    await act(async () => { input.props.onChange({ target: { files: [file], value: file.name } }); });
    expect(await screen.findByText('Review before upload')).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/^Full schedule \(replaces\)\./));
    await act(async () => { fireEvent.press(screen.getByText('Upload Reviewed Document')); });
    expect(mockAuth.uploadDocument).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(`Document and 2 reviewed schedule tasks uploaded. Use Make Current when this schedule should replace the active version. ${LINE}`)).toBeTruthy();
  });
});

describe('2.38: the desktop provider computes the lines the page shows (source; its functions are run in the records test)', () => {
  const fs = jest.requireActual('fs') as typeof import('fs');
  const path = jest.requireActual('path') as typeof import('path');
  const provider = fs.readFileSync(path.resolve(__dirname, '../../components/web-shell/desktop-auth-provider.tsx'), 'utf8');
  it('the upload resolves with the line of its own plan; Make Current keeps the line of the tasks shown before and after', () => {
    expect(provider).toContain('return scheduleUploadTurnedHighLine(plan);');
    expect(provider).toContain('const turnedHigh = scheduleTurnedHighLineBetween(shownBefore, (snapshotRef.current?.scheduleItems ?? []).map(item => carriedById.get(item.id) ?? item));');
    expect(provider).toContain('if (turnedHigh) turnedHighByScheduleRef.current.set(document.id, turnedHigh);');
  });
});
