import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useECOSProjectQuestionExperience } from '../../hooks/use-ecos-project-question-experience';
import { askECOSProjectQuestion } from '../../services/ECOSProjectQuestion';
jest.mock('expo-crypto', () => ({ randomUUID: () => '55555555-5555-4555-8555-555555555555' }));

jest.mock('../../components/DAVETypedCaptureSheet', () => ({ DAVETypedCaptureSheet: () => null }));
jest.mock('../../components/DAVEVoiceCaptureSheet', () => ({ DAVEVoiceCaptureSheet: () => null }));
jest.mock('../../components/ECOSProjectAnswerSheet', () => ({ ECOSProjectAnswerSheet: () => null }));
jest.mock('../../services/SupabaseService', () => ({ getSupabaseClient: () => ({}) }));
jest.mock('../../components/native-workspace-owner', () => ({ useNativeWorkspaceOwner: () => 'owner-one' }));
// The real helpers, only the cloud request mocked (closed projects, audit A9 pass 3 L1).
jest.mock('../../services/ECOSProjectQuestion', () => ({
  ...jest.requireActual('../../services/ECOSProjectQuestion'),
  askECOSProjectQuestion: jest.fn(),
}));
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

it('retains the same answer and all sources through repeated document proof round trips', async () => {
  const sources = ['A', 'B', 'C'].map(name => ({
    sourceType: 'document', recordId: name, documentCitation: { documentId: name },
  }));
  const answer = { answer: 'Three distinct areas', supportingEvidence: sources };
  askMock.mockResolvedValue(answer as never);
  const onOpenEvidence = jest.fn();
  const { result, rerender } = renderHook<ReturnType<typeof useECOSProjectQuestionExperience>, { documentEvidenceVisible: boolean }>(({ documentEvidenceVisible }) => useECOSProjectQuestionExperience({
    contextualProjectName: 'Project One', projectRecords: [{ id: 'one', name: 'Project One' }] as never,
    candidateProjects: ['Project One'], onOpenEvidence, documentEvidenceVisible,
  }), { initialProps: { documentEvidenceVisible: false } });
  await start(result);
  for (const source of [...sources, sources[0]]) {
    await act(async () => { sheet(result, 2).onOpenEvidence(source); });
    await rerender({ documentEvidenceVisible: true });
    expect(sheet(result, 2)).toMatchObject({ visible: false, question, answer });
    await rerender({ documentEvidenceVisible: false });
    expect(sheet(result, 2)).toMatchObject({ visible: true, question, answer });
    expect(sheet(result, 2).answer).toBe(answer);
    expect(onOpenEvidence).toHaveBeenLastCalledWith('Project One', source);
  }
  expect(askMock).toHaveBeenCalledTimes(1);
  await act(async () => { sheet(result, 2).onClose(); });
  await rerender({ documentEvidenceVisible: true });
  await rerender({ documentEvidenceVisible: false });
  expect(sheet(result, 2)).toMatchObject({ visible: false, answer: null });
});

it('does not resurrect an old answer after changing projects while proof is open', async () => {
  askMock.mockResolvedValue({ answer: 'Project One answer' } as never);
  const { result, rerender } = renderHook<ReturnType<typeof useECOSProjectQuestionExperience>, { documentEvidenceVisible: boolean }>(({ documentEvidenceVisible }) => useECOSProjectQuestionExperience({
    contextualProjectName: 'Project One',
    projectRecords: [{ id: 'one', name: 'Project One' }, { id: 'two', name: 'Project Two' }] as never,
    candidateProjects: ['Project One', 'Project Two'], onOpenEvidence: jest.fn(), documentEvidenceVisible,
  }), { initialProps: { documentEvidenceVisible: false } });
  await start(result);
  await act(async () => { sheet(result, 2).onOpenEvidence({ sourceType: 'document', documentCitation: { documentId: 'A' } }); });
  await rerender({ documentEvidenceVisible: true });
  await act(async () => { sheet(result, 0).onProjectChange('Project Two'); });
  await rerender({ documentEvidenceVisible: false });
  expect(sheet(result, 2)).toMatchObject({ visible: false, answer: null, projectName: 'Project Two' });
});

it('still dismisses the answer when navigating to a non-document record', async () => {
  askMock.mockResolvedValue({ answer: 'Task answer' } as never);
  const onOpenEvidence = jest.fn();
  const { result } = renderHook(() => useECOSProjectQuestionExperience({
    contextualProjectName: 'Project One', projectRecords: [{ id: 'one', name: 'Project One' }] as never,
    candidateProjects: ['Project One'], onOpenEvidence,
  }));
  await start(result);
  const evidence = { sourceType: 'task', recordId: 'task-one' };
  await act(async () => { sheet(result, 2).onOpenEvidence(evidence); });
  expect(sheet(result, 2)).toMatchObject({ visible: false, answer: null });
  expect(onOpenEvidence).toHaveBeenCalledWith('Project One', evidence);
});

it('preserves the server turn through the mobile Ask Another Question flow', async () => {
  const turnId = '11111111-1111-4111-8111-111111111111';
  askMock.mockImplementation(async input => ({
    answer: 'First answer', conversation: { conversationId: input.conversationId, turnId, priorTurnId: input.priorTurnId || null },
  }) as never);
  const { result } = renderHook(() => useECOSProjectQuestionExperience({
    contextualProjectName: 'Project One', projectRecords: [{ id: 'one', name: 'Project One' }] as never,
    candidateProjects: ['Project One'], onOpenEvidence: jest.fn(),
  }));
  await start(result);
  await act(async () => { sheet(result, 2).onAskAnother(); });
  await act(async () => { sheet(result, 0).onMemoryReady({ transcript: 'And canopy C?' }); });
  expect(askMock.mock.calls[1][0]).toMatchObject({ question: 'And canopy C?', priorTurnId: turnId,
    conversationId: askMock.mock.calls[0][0].conversationId, projectId: 'one' });
});

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
  // Build 231 E1 item 1: the first X stops the wait and keeps the question; the second closes.
  await act(async () => { sheet(result, 2).onClose(); });
  expect(sheet(result, 2)).toMatchObject({ visible: true, loading: false, question, answer: null });
  await act(async () => { sheet(result, 2).onClose(); });
  await act(async () => { pending.resolve({ answer: 'Late answer' } as never); });
  expect(sheet(result, 2)).toMatchObject({ visible: false, answer: null });
});

describe('askFor (a Talk document match asked again in Ask ECOS, audit A9 pass 1 #3)', () => {
  const records = [{ id: 'one', name: 'Project One' }, { id: 'two', name: 'Project Two' }] as never;

  it('asks the same question for the named project, not the contextual one, and opens the answer', async () => {
    askMock.mockResolvedValue({ answer: 'Guardrails at every open parking edge' } as never);
    const { result } = renderHook(() => useECOSProjectQuestionExperience({
      contextualProjectName: 'Project One', projectRecords: records,
      candidateProjects: ['Project One', 'Project Two'], onOpenEvidence: jest.fn(),
    }));
    await act(async () => { result.current.askFor(' project two ', 'Where are the  guardrails?'); });
    expect(askMock).toHaveBeenCalledTimes(1);
    expect(askMock.mock.calls[0][0]).toMatchObject({
      projectId: 'two', projectName: 'project two', question: 'Where are the guardrails?',
    });
    expect(sheet(result, 2)).toMatchObject({
      visible: true, projectName: 'project two', question: 'Where are the guardrails?',
      loading: false, answer: { answer: 'Guardrails at every open parking edge' },
    });
  });

  it('asks in the current project when it is already selected', async () => {
    askMock.mockResolvedValue({ answer: 'Same project' } as never);
    const { result } = renderHook(() => useECOSProjectQuestionExperience({
      contextualProjectName: 'Project One', projectRecords: records,
      candidateProjects: ['Project One', 'Project Two'], onOpenEvidence: jest.fn(),
    }));
    await start(result);
    await act(async () => { result.current.askFor('Project One', 'And the ramp?'); });
    expect(askMock).toHaveBeenCalledTimes(2);
    expect(askMock.mock.calls[1][0]).toMatchObject({ projectId: 'one', question: 'And the ramp?' });
    expect(sheet(result, 2)).toMatchObject({ visible: true, question: 'And the ramp?', answer: { answer: 'Same project' } });
  });

  it('an unknown project gives the Choose a project message and asks nothing, not even in the selected project', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { result } = renderHook(() => useECOSProjectQuestionExperience({
      contextualProjectName: 'Project One', projectRecords: records,
      candidateProjects: ['Project One', 'Project Two'], onOpenEvidence: jest.fn(),
    }));
    await act(async () => { result.current.open(); });
    let started: boolean | undefined;
    await act(async () => { started = result.current.askFor('Project Nine', 'Where are the guardrails?'); });
    // Audit A9 pass 2 F4: Talk keeps its answer when Ask ECOS did not start.
    expect(started).toBe(false);
    expect(result.current.canAskFor('Project Nine')).toBe(false);
    expect(result.current.canAskFor(' project two ')).toBe(true);
    expect(alert).toHaveBeenCalledWith('Choose a project', 'Ask ECOS needs one synchronized project before it can review project evidence.');
    expect(askMock).not.toHaveBeenCalled();
    expect(sheet(result, 2)).toMatchObject({ visible: false, answer: null });
    alert.mockRestore();
  });

  // Audit A9 pass 2 F2: a question sent from Talk is read on its own, never
  // against an older Ask ECOS question of the project. expo-crypto is mocked
  // to one id, so the new conversation shows as no priorTurnId.
  it('starts a new Ask ECOS conversation (no priorTurnId), and a question after it continues that one', async () => {
    const turnIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
    askMock.mockImplementation(async input => ({
      answer: 'Answer', conversation: { conversationId: input.conversationId, turnId: turnIds[askMock.mock.calls.length - 1], priorTurnId: input.priorTurnId || null },
    }) as never);
    const { result } = renderHook(() => useECOSProjectQuestionExperience({
      contextualProjectName: 'Project One', projectRecords: records,
      candidateProjects: ['Project One', 'Project Two'], onOpenEvidence: jest.fn(),
    }));
    await start(result);
    let started: boolean | undefined;
    await act(async () => { started = result.current.askFor('Project One', 'Why is that?'); });
    expect(started).toBe(true);
    expect(askMock).toHaveBeenCalledTimes(2);
    expect(askMock.mock.calls[1][0]).toMatchObject({ projectId: 'one', question: 'Why is that?' });
    expect(askMock.mock.calls[1][0].priorTurnId).toBeUndefined();
    await act(async () => { sheet(result, 2).onAskAnother(); });
    await act(async () => { sheet(result, 0).onMemoryReady({ transcript: 'And canopy C?' }); });
    expect(askMock.mock.calls[2][0].priorTurnId).toBe(turnIds[1]);
  });
});

it('checks each question against the projects the user can pick (owner answer Q20, audit A9 pass 1 #2)', async () => {
  askMock.mockResolvedValue({ answer: 'The footings use 4000 psi concrete.' } as never);
  const { result } = renderHook(() => useECOSProjectQuestionExperience({
    contextualProjectName: '2321 Compliance Project',
    projectRecords: [
      { id: 'p2321', name: '2321 Compliance Project' },
      { id: 'p2375', name: '2375 Compliance Project' },
    ] as never,
    candidateProjects: [' 2321 Compliance Project ', '2375 Compliance Project', '2375 Compliance Project', ''],
    onOpenEvidence: jest.fn(),
  }));
  await start(result);
  expect(askMock).toHaveBeenCalledTimes(1);
  expect(askMock.mock.calls[0][0]).toMatchObject({ projectId: 'p2321', question });
  expect(askMock.mock.calls[0][0].knownProjectNames).toEqual(['2321 Compliance Project', '2375 Compliance Project']);
  // The phone answer sheet has no project picker, so it asks for phone wording (audit A9 pass 3 L3).
  expect(askMock.mock.calls[0][0].refusalWording).toBe('phone');
});
