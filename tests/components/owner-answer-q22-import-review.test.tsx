/**
 * Owner answer Q22 (David, 30 Sep 2026): at import review David marks a
 * schedule "Lookahead / partial (adds to the master)" or "Full schedule
 * (replaces)". The review suggests one from the file and the saved master,
 * says why in plain words, and saves his choice on the schedule file.
 * Synthetic data.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import type { PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const document = (id: string, name: string, importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name, originalFileName: `${name}.pdf`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...extra,
}) as ReferenceDocument;
const row = (id: string, taskName: string, startDate: string, finishDate: string, batchId: string) => ({
  id, taskName, projectName: 'Alpha', locationName: 'Lot', startDate, finishDate, milestone: '', owner: 'David',
  contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
  createdAt: '2026-09-20T12:00:00.000Z', importBatchId: batchId,
}) as ScheduleItem;

const master = document('master', 'MASTER UPDATE 8312026', '2026-08-31T12:00:00.000Z', { projectNames: ['Alpha', 'Beta'], projectName: null });
const masterItems = [
  row('m-1', 'Pour slab', '10/01/2026', '10/03/2026', 'batch-master'),
  row('m-2', 'Roofing', '12/01/2026', '12/15/2026', 'batch-master'),
];
const batch = (name: string, extra: Partial<PIEScheduleImportBatch> = {}): PIEScheduleImportBatch => ({
  id: 'batch-new', kind: 'schedule_file', sourceCount: 1, sourceLabel: `${name}.pdf`, message: 'Two activities extracted.',
  documents: [document('new', name, '2026-09-20T12:00:00.000Z', { importBatchId: 'batch-new' })],
  items: [
    row('n-1', 'Pour slab', '09/28/2026', '09/30/2026', 'batch-new'),
    row('n-2', 'Rebar inspection', '09/25/2026', '09/25/2026', 'batch-new'),
  ],
  ...extra,
});

function renderReview(incoming: PIEScheduleImportBatch, withMaster: boolean | ReferenceDocument[] = true) {
  const onApprove = jest.fn(async (_batch: PIEScheduleImportBatch) => undefined);
  const view = render(
    <ScheduleImportFlow
      screenshotImportAvailable={false}
      onImportFile={jest.fn(async () => null)}
      onImportScreenshots={jest.fn(async () => null)}
      onAddManually={jest.fn()}
      onApprove={onApprove}
      onCancel={jest.fn()}
      incomingBatch={incoming}
      onIncomingBatchConsumed={jest.fn()}
      roleContext={Array.isArray(withMaster) ? { documents: withMaster, items: masterItems }
        : withMaster ? { documents: [master], items: masterItems } : { documents: [], items: [] }}
    />,
  );
  return { ...view, onApprove };
}

async function acceptAll(view: ReturnType<typeof renderReview>) {
  await act(async () => {
    fireEvent.press(view.getByText('Accept All (2)'));
    await Promise.resolve();
  });
}

describe('the import review asks how the schedule is used (owner answer Q22)', () => {
  it('suggests Lookahead for a "3 Week Lookahead" with a master, says why, and saves it', async () => {
    const view = renderReview(batch('Alpha 3 Week Lookahead'));
    expect(await view.findByText('How should Vitruvius use this schedule?')).toBeTruthy();
    expect(view.getByText('Full schedule (replaces)')).toBeTruthy();
    expect(view.getByText('Lookahead / partial (adds to the master)')).toBeTruthy();
    expect(view.getByText('Keep the master schedule. A task in both files shows once, with this file’s dates and progress. Tasks only in this file are added. The master’s other tasks stay.')).toBeTruthy();
    expect(view.getByText('Suggested: Lookahead / partial (adds to the master), because its name says “3 Week”. You can change this before saving.')).toBeTruthy();
    expect(view.getByRole('radio', { name: /^Lookahead/ }).props.accessibilityState).toMatchObject({ checked: true });
    await acceptAll(view);
    expect(view.onApprove).toHaveBeenCalledTimes(1);
    expect(view.onApprove.mock.calls[0][0].documents.map(item => item.scheduleRole)).toEqual(['lookahead']);
  });

  it('David can change the suggestion; his choice is what is saved', async () => {
    const view = renderReview(batch('Alpha 3 Week Lookahead'));
    await view.findByText('How should Vitruvius use this schedule?');
    fireEvent.press(view.getByRole('radio', { name: /^Full schedule/ }));
    expect(view.getByRole('radio', { name: /^Full schedule/ }).props.accessibilityState).toMatchObject({ checked: true });
    await acceptAll(view);
    expect(view.onApprove.mock.calls[0][0].documents.map(item => item.scheduleRole)).toEqual(['master']);
  });

  it('with no master saved for the project it suggests Full schedule, and a file of weeks against a master of months suggests Lookahead', async () => {
    const first = renderReview(batch('Alpha 3 Week Lookahead'), false);
    expect(await first.findByText('Suggested: Full schedule (replaces), because there is no master schedule for Alpha yet. You can change this before saving.')).toBeTruthy();
    first.unmount();
    const second = renderReview(batch('Alpha field plan'));
    expect(await second.findByText('Suggested: Lookahead / partial (adds to the master), because its dates cover 6 days and the master for Alpha covers 11 weeks. You can change this before saving.')).toBeTruthy();
  });

  it('the phone\'s Schedule screen gives the review the saved schedules and tasks', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    // Pin updated deliberately (audit round 2, A8 pass 7 L2, 30 Sep 2026): the review gets every saved
    // document, as the pick checks them, not the Schedule screen's Schedules-only list.
    expect(app).toContain("roleContext={{ documents: reviewDocuments, items: scheduleItems as unknown as import('./types').ScheduleItem[] }}");
    expect(app).toContain('reviewDocuments={referenceDocuments}');
  });

  it('a file already saved as a full schedule, imported again, is offered as a lookahead only (whole-app audit A8 pass 5 L3)', async () => {
    const again = batch('Alpha 3 Week Lookahead', {
      documents: [document('new', 'Alpha 3 Week Lookahead', '2026-09-20T12:00:00.000Z', { importBatchId: 'batch-new', scheduleRole: 'lookahead' })],
    });
    const view = renderReview(again);
    expect(await view.findByText('Suggested: Lookahead / partial (adds to the master), because this exact file is already saved as a full schedule for these projects, so it can only be added again as a lookahead.')).toBeTruthy();
    expect(view.getByRole('radio', { name: /^Lookahead/ }).props.accessibilityState).toMatchObject({ checked: true });
    // Saving it as a full schedule again would only duplicate it: refused, with what to do instead.
    fireEvent.press(view.getByRole('radio', { name: /^Full schedule/ }));
    await acceptAll(view);
    expect(view.onApprove).not.toHaveBeenCalled();
    expect(view.getByText('This exact schedule is already saved as a full schedule for these projects. Choose Lookahead to add it to the master schedule, or Reject Import.')).toBeTruthy();
    fireEvent.press(view.getByRole('radio', { name: /^Lookahead/ }));
    await acceptAll(view);
    expect(view.onApprove.mock.calls.map(call => call[0].documents.map(item => item.scheduleRole))).toEqual([['lookahead']]);
  });

  it('while the file\'s full copy is the schedule shown, the review refuses it either way: make the master current first (A8 pass 5 M1, A5 pass 6 L1)', async () => {
    const copy = document('old-copy', 'Alpha 3 Week Lookahead', '2026-09-15T12:00:00.000Z', { contentSha256: 'sha-alpha-lookahead' });
    const again = batch('Alpha 3 Week Lookahead', {
      documents: [document('new', 'Alpha 3 Week Lookahead', '2026-09-20T12:00:00.000Z', { importBatchId: 'batch-new', scheduleRole: 'lookahead', contentSha256: 'sha-alpha-lookahead' })],
    });
    const view = renderReview(again, [master, copy]);
    expect(await view.findByText('Suggested: Lookahead / partial (adds to the master), because this exact file is the full schedule shown now for these projects. Make your master current first, then import this as a lookahead.')).toBeTruthy();
    await acceptAll(view);
    expect(view.onApprove).not.toHaveBeenCalled();
    expect(view.getByText('This exact schedule is the full schedule shown now for these projects. Make your master current first, then import this as a lookahead.')).toBeTruthy();
    view.unmount();
    // With the master made current, it is added as a lookahead.
    const current = renderReview(again, [{ ...master, importedAt: '2026-09-16T12:00:00.000Z' }, { ...copy, isCurrent: false }]);
    await current.findByText('How should Vitruvius use this schedule?');
    await acceptAll(current);
    expect(current.onApprove.mock.calls.map(call => call[0].documents.map(item => item.scheduleRole))).toEqual([['lookahead']]);
  });

  it('message screenshots are never asked, and their documents get no role', async () => {
    const view = renderReview(batch('Schedule message', {
      kind: 'message_screenshots',
      documents: [document('shot', 'Schedule message - text', '2026-09-20T12:00:00.000Z', { category: 'Other', isCurrent: false })],
    }));
    await view.findByText('Review Imported Schedule');
    expect(view.queryByText('How should Vitruvius use this schedule?')).toBeNull();
    await acceptAll(view);
    expect(view.onApprove.mock.calls[0][0].documents[0]).not.toHaveProperty('scheduleRole');
  });
});
