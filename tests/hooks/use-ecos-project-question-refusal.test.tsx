import { act, renderHook } from '@testing-library/react-native';
import { useECOSProjectQuestionExperience } from '../../hooks/use-ecos-project-question-experience';

// Audit A9 pass 3 L3 (30 Sep 2026): the phone refusal said "Select project 2375
// above, then ask again", but the phone answer sheet has no project picker, and
// "Ask Another Question" asks the same project again. The real service runs
// here (only the sheets and the cloud client are stand-ins); the refusal comes
// before any cloud request. Synthetic project names.

jest.mock('expo-crypto', () => ({ randomUUID: () => '55555555-5555-4555-8555-555555555555' }));
jest.mock('../../components/DAVETypedCaptureSheet', () => ({ DAVETypedCaptureSheet: () => null }));
jest.mock('../../components/DAVEVoiceCaptureSheet', () => ({ DAVEVoiceCaptureSheet: () => null }));
jest.mock('../../components/ECOSProjectAnswerSheet', () => ({ ECOSProjectAnswerSheet: () => null }));
const mockClient = { auth: { getSession: jest.fn() }, functions: { invoke: jest.fn() } };
jest.mock('../../services/SupabaseService', () => ({ getSupabaseClient: () => mockClient }));
jest.mock('../../components/native-workspace-owner', () => ({ useNativeWorkspaceOwner: () => 'owner-one' }));

type Experience = ReturnType<typeof useECOSProjectQuestionExperience>;
const sheet = (result: { current: Experience }, index: number) => result.current.sheets.props.children[index].props;

const PROJECT_RECORDS = [
  { id: 'p2321', name: '2321 Compliance Project' },
  { id: 'p2375', name: '2375 Compliance Project' },
];

async function refusalFor(question: string) {
  const { result } = renderHook(() => useECOSProjectQuestionExperience({
    contextualProjectName: '2321 Compliance Project',
    projectRecords: PROJECT_RECORDS as never,
    candidateProjects: PROJECT_RECORDS.map(project => project.name),
    onOpenEvidence: jest.fn(),
  }));
  await act(async () => { result.current.open(); });
  await act(async () => { sheet(result, 0).onMemoryReady({ transcript: question }); });
  return result;
}

describe('audit A9 pass 3 L3: the phone refusal matches what the phone can do', () => {
  beforeEach(() => jest.clearAllMocks());

  it('tells David to close the answer and open the other project, not to use a picker', async () => {
    const result = await refusalFor('What was the slab thickness at 2375?');
    const answerSheet = sheet(result, 2);
    expect(answerSheet).toMatchObject({ visible: true, loading: false, answer: null });
    expect(answerSheet.error).toBe(
      'Project 2321 is selected, but this question names 2375. Close this, open project 2375, then ask again.',
    );
    expect(answerSheet.error).not.toMatch(/above/);
    expect(mockClient.auth.getSession).not.toHaveBeenCalled();
    expect(mockClient.functions.invoke).not.toHaveBeenCalled();
  });

  it('"Ask Another Question" after the refusal reopens the question for the same project', async () => {
    const result = await refusalFor('What was the slab thickness at 2375?');
    await act(async () => { sheet(result, 2).onAskAnother(); });
    expect(sheet(result, 0)).toMatchObject({ visible: true, projectName: '2321 Compliance Project' });
  });
});
