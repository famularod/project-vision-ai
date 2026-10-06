/**
 * Owner answer Q30 (David, 2 Oct 2026): "YES, repeated task names within an
 * area. The import review asks him to confirm instead of guessing."
 *
 * The review shows a check, "2 tasks named Pour slab in Lot — confirm which
 * is which", listing each saved task (dates, %, note) beside the file's rows,
 * the app's best guess selected. Accept waits until he confirms; his choice
 * goes to the approval (pairingChoices), which pairs by it. Nothing is asked
 * when the dates settle it. Synthetic data.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import type { PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const document = (id: string, importedAt: string) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const row = (id: string, taskName: string, startDate: string, finishDate: string, batchId: string, extra: Partial<ScheduleItem> = {}) => ({
  id, taskName, projectName: 'Alpha', locationName: 'Lot', startDate, finishDate, milestone: '', owner: 'David',
  contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
  createdAt: '2026-09-20T12:00:00.000Z', importBatchId: batchId, sourceDocumentId: batchId.replace('batch-', ''), ...extra,
}) as ScheduleItem;

const master = document('master', '2026-09-20T12:00:00.000Z');
const saved = [
  row('m-1', 'Pour slab', '10/05/2026', '10/09/2026', 'batch-master', { percentComplete: 80, status: 'In Progress', notes: 'Forms stripped', progressSource: 'project_manager' }),
  row('m-2', 'Pour slab', '10/12/2026', '10/16/2026', 'batch-master'),
  row('m-3', 'Framing', '10/26/2026', '10/30/2026', 'batch-master'),
];
const batch = (items: ScheduleItem[]): PIEScheduleImportBatch => ({
  id: 'batch-new', kind: 'schedule_file', sourceCount: 1, sourceLabel: 'MASTER G.csv', message: 'Three activities extracted.',
  documents: [{ ...document('new', '2026-10-01T12:00:00.000Z'), importBatchId: 'batch-new' }],
  items,
});
const slipped = batch([
  row('n-1', 'Pour slab', '10/12/2026', '10/16/2026', 'batch-new'),
  row('n-2', 'Pour slab', '10/19/2026', '10/23/2026', 'batch-new'),
  row('n-3', 'Framing', '10/26/2026', '10/30/2026', 'batch-new'),
]);

function renderReview(incoming: PIEScheduleImportBatch) {
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
      roleContext={{ documents: [master], items: saved }}
    />,
  );
  return { ...view, onApprove };
}
async function press(view: ReturnType<typeof renderReview>, text: string) {
  await act(async () => {
    fireEvent.press(view.getByText(text));
    await Promise.resolve();
  });
}
const TITLE = '2 tasks named Pour slab in Lot — confirm which is which';

describe('owner answer Q30: the import review asks which same-named task is which', () => {
  it('lists each saved task (dates, %, note) beside the rows, the best guess selected', async () => {
    const view = renderReview(slipped);
    expect(await view.findByText(TITLE)).toBeTruthy();
    expect(view.getByText('Saved Pour slab 1: 10/5–10/9 · 80% · “Forms stripped”')).toBeTruthy();
    expect(view.getByText('Saved Pour slab 2: 10/12–10/16 · 0%')).toBeTruthy();
    const checked = view.getAllByRole('radio').filter(radio => radio.props.accessibilityState?.checked)
      .map(radio => radio.props.accessibilityLabel as string).filter(label => label.startsWith('Saved Pour slab'));
    // The master rule's guess: every date slipped one week.
    expect(checked).toEqual([
      'Saved Pour slab 1, 10/5–10/9 · 80% · “Forms stripped”: This file: 10/12–10/16 · 0%',
      'Saved Pour slab 2, 10/12–10/16 · 0%: This file: 10/19–10/23 · 0%',
    ]);
  });

  it('Accept waits for his confirmation, then sends the guess he confirmed', async () => {
    const view = renderReview(slipped);
    await view.findByText(TITLE);
    await press(view, 'Accept All (3)');
    expect(view.onApprove).not.toHaveBeenCalled();
    expect(view.getByText('Confirm which Pour slab is which in Lot before saving.')).toBeTruthy();
    await press(view, 'Confirm');
    expect(view.getByText('Confirmed')).toBeTruthy();
    await press(view, 'Accept All (3)');
    expect(view.onApprove).toHaveBeenCalledTimes(1);
    expect(view.onApprove.mock.calls[0][0].pairingChoices).toEqual({ 'n-1': 'm-1', 'n-2': 'm-2' });
  });

  it('"the first was dropped and a new one added": his choice is what the approval gets', async () => {
    const view = renderReview(slipped);
    await view.findByText(TITLE);
    await act(async () => {
      fireEvent.press(view.getByLabelText('Saved Pour slab 2, 10/12–10/16 · 0%: This file: 10/12–10/16 · 0%'));
      await Promise.resolve();
    });
    // Saved 1 gave up 10/12 to saved 2; 10/19 is new.
    expect(view.getByLabelText('Saved Pour slab 1, 10/5–10/9 · 80% · “Forms stripped”: Not in this file').props.accessibilityState.checked).toBe(true);
    expect(view.getByText('New Pour slab: 10/19–10/23 · 0%')).toBeTruthy();
    await press(view, 'Accept All (3)');
    expect(view.onApprove.mock.calls[0][0].pairingChoices).toEqual({ 'n-1': 'm-2', 'n-2': null });
  });

  it('asks nothing when the dates settle it', async () => {
    const view = renderReview(batch([
      row('n-1', 'Pour slab', '10/05/2026', '10/09/2026', 'batch-new'),
      row('n-2', 'Pour slab', '10/12/2026', '10/16/2026', 'batch-new'),
      row('n-3', 'Framing', '10/26/2026', '10/30/2026', 'batch-new'),
    ]));
    expect(await view.findByText('Review Imported Schedule')).toBeTruthy();
    expect(view.queryByText(/confirm which is which/)).toBeNull();
    await press(view, 'Accept All (3)');
    expect(view.onApprove).toHaveBeenCalledTimes(1);
    expect(view.onApprove.mock.calls[0][0].pairingChoices).toBeUndefined();
  });
});
