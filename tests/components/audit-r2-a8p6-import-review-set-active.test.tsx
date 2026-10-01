/**
 * Audit round 2, A8 pass 6 L1 (30 Sep 2026), in the import review: master F
 * was replaced by M2 and M2 deleted, so the project shows no schedule. F's
 * file picked again came preset and forced to Lookahead; accepted, the master
 * became its own lookahead. The review now says to use Set Active, and Accept
 * refuses either choice while a project F covers shows no full schedule. With
 * another master shown, it saves as a lookahead as before. Synthetic data.
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
  createdAt: '2026-09-30T12:00:00.000Z', importBatchId: batchId,
}) as ScheduleItem;

// F as the cloud leaves it once M2 was made current; M2 is the newer master.
const savedF = document('master-f', 'MASTER UPDATE 8312026', '2026-08-31T12:00:00.000Z', { isCurrent: false, contentSha256: 'sha-master-f' });
const m2 = document('master-2', 'MASTER UPDATE 9262026', '2026-09-26T12:00:00.000Z');
const items = [row('f-1', 'Pour slab', '10/01/2026', '10/03/2026', 'batch-master-f'), row('m2-1', 'Pour slab', '10/02/2026', '10/04/2026', 'batch-master-2')];
// F's file picked again, preset to Lookahead (A8 pass 5 L3).
const again: PIEScheduleImportBatch = {
  id: 'batch-again', kind: 'schedule_file', sourceCount: 1, sourceLabel: 'MASTER UPDATE 8312026.pdf', message: 'Two activities extracted.',
  documents: [document('again', 'MASTER UPDATE 8312026', '2026-09-30T12:00:00.000Z', { importBatchId: 'batch-again', scheduleRole: 'lookahead', contentSha256: 'sha-master-f' })],
  items: [row('a-1', 'Pour slab', '10/01/2026', '10/03/2026', 'batch-again'), row('a-2', 'Frame walls', '10/05/2026', '10/09/2026', 'batch-again')],
};
const SET_ACTIVE = 'This schedule file is already saved. Open it in Schedule Sources and use Set Active to show it again.';

function renderReview(documents: ReferenceDocument[]) {
  const onApprove = jest.fn(async (_batch: PIEScheduleImportBatch) => undefined);
  const view = render(
    <ScheduleImportFlow
      screenshotImportAvailable={false}
      onImportFile={jest.fn(async () => null)}
      onImportScreenshots={jest.fn(async () => null)}
      onAddManually={jest.fn()}
      onApprove={onApprove}
      onCancel={jest.fn()}
      incomingBatch={again}
      onIncomingBatchConsumed={jest.fn()}
      roleContext={{ documents, items }}
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

describe('A8 pass 6 L1: the review never makes the old master its own lookahead while its project shows no schedule', () => {
  it('M2 deleted: the review says to use Set Active, and Accept refuses Lookahead and Full schedule alike', async () => {
    const view = renderReview([savedF]);
    expect(await view.findByText('Suggested: Lookahead / partial (adds to the master), because this schedule file is already saved. Open it in Schedule Sources and use Set Active to show it again.')).toBeTruthy();
    await acceptAll(view);
    expect(view.onApprove).not.toHaveBeenCalled();
    expect(view.getByText(SET_ACTIVE)).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByRole('radio', { name: /^Full schedule/ }));
      await Promise.resolve();
    });
    await acceptAll(view);
    expect(view.onApprove).not.toHaveBeenCalled();
    expect(view.getByText(SET_ACTIVE)).toBeTruthy();
    view.unmount();
  });

  it('with M2 shown, it is added as a lookahead, as before', async () => {
    const view = renderReview([savedF, m2]);
    await view.findByText('How should Vitruvius use this schedule?');
    await acceptAll(view);
    expect(view.onApprove.mock.calls.map(call => call[0].documents.map(item => item.scheduleRole))).toEqual([['lookahead']]);
    view.unmount();
  });
});
