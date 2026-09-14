import { act, renderHook } from '@testing-library/react-native';
import { useECOSProjectQuestionExperience } from '../../hooks/use-ecos-project-question-experience';
import { askECOSProjectQuestion } from '../../services/ECOSProjectQuestion';

jest.mock('../../components/DAVETypedCaptureSheet', () => ({ DAVETypedCaptureSheet: () => null }));
jest.mock('../../components/DAVEVoiceCaptureSheet', () => ({ DAVEVoiceCaptureSheet: () => null }));
jest.mock('../../components/ECOSProjectAnswerSheet', () => ({ ECOSProjectAnswerSheet: () => null }));
jest.mock('../../services/SupabaseService', () => ({ getSupabaseClient: () => ({}) }));
jest.mock('../../services/ECOSProjectQuestion', () => ({ askECOSProjectQuestion: jest.fn() }));
const askMock = jest.mocked(askECOSProjectQuestion);
const question = 'What work remains?';
function deferred() {
  let resolve!: (value: never) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<never>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function sheet(result: { current: ReturnType<typeof useECOSProjectQuestionExperience> }, index: number) {
  return result.current.sheets.props.children[index].props;
}
async function start(result: { current: ReturnType<typeof useECOSProjectQuestionExperience> }) {
  await act(async () => { result.current.open(); });
  await act(async () => { sheet(result, 0).onMemoryReady({ transcript: question }); });
}
beforeEach(() => askMock.mockReset());

it.each(['answer', 'error'])('ignores a late prior-project %s for identical question wording', async kind => {
  const first = deferred(), second = deferred();
  askMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result, rerender } = renderHook<ReturnType<typeof useECOSProjectQuestionExperience>, { selected: string }>(({ selected }) => useECOSProjectQuestionExperience({
    contextualProjectName: selected,
    projectRecords: [{ id: 'one', name: 'Project One' }, { id: 'two', name: 'Project Two' }] as never,
    candidateProjects: ['Project One', 'Project Two'], onOpenEvidence: jest.fn(),
  }), { initialProps: { selected: 'Project One' } });
  await start(result);
  await rerender({ selected: 'Project Two' });
  await start(result);
  await act(async () => {
    if (kind === 'answer') first.resolve({ answer: 'Wrong project answer' } as never);
    else first.reject(new Error('Old request failure'));
  });
  expect(sheet(result, 2)).toMatchObject({ projectName: 'Project Two', loading: true, error: null, answer: null });
  await act(async () => { second.resolve({ answer: 'Project Two answer' } as never); });
  expect(sheet(result, 2)).toMatchObject({ projectName: 'Project Two', loading: false, answer: { answer: 'Project Two answer' } });
});

it('does not reopen a dismissed answer when its request finishes', async () => {
  const pending = deferred();
  askMock.mockReturnValueOnce(pending.promise);
  const { result } = renderHook(() => useECOSProjectQuestionExperience({
    contextualProjectName: 'Project One', projectRecords: [{ id: 'one', name: 'Project One' }] as never,
    candidateProjects: ['Project One'], onOpenEvidence: jest.fn(),
  }));
  await start(result);
  await act(async () => { sheet(result, 2).onClose(); });
  await act(async () => { pending.resolve({ answer: 'Late answer' } as never); });
  expect(sheet(result, 2)).toMatchObject({ visible: false, answer: null });
});
