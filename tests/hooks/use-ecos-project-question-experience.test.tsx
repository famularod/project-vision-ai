import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import { useECOSProjectQuestionExperience } from '../../hooks/use-ecos-project-question-experience';

const mockAskECOSProjectQuestion = jest.fn();
let latestVoiceProps: any = null;

jest.mock('../../services/ECOSProjectQuestion', () => ({
  askECOSProjectQuestion: (input: unknown) => mockAskECOSProjectQuestion(input),
}));
jest.mock('../../services/SupabaseService', () => ({
  getSupabaseClient: () => null,
}));
jest.mock('../../components/DAVEVoiceCaptureSheet', () => ({
  DAVEVoiceCaptureSheet: (props: any) => {
    latestVoiceProps = props;
    const React = require('react');
    const Native = require('react-native');
    return props.visible ? React.createElement(
      Native.View,
      null,
      React.createElement(Native.Text, null, `Voice project: ${props.projectId || 'none'}`),
      React.createElement(
        Native.Pressable,
        {
          accessibilityRole: 'button',
          accessibilityLabel: 'Submit project question',
          onPress: () => props.onMemoryReady({ transcript: 'What needs attention?' }),
        },
        React.createElement(Native.Text, null, 'Submit project question'),
      ),
    ) : null;
  },
}));
jest.mock('../../components/DAVETypedCaptureSheet', () => ({
  DAVETypedCaptureSheet: () => null,
}));
jest.mock('../../components/ECOSProjectAnswerSheet', () => ({
  ECOSProjectAnswerSheet: (props: any) => {
    const React = require('react');
    const Native = require('react-native');
    return props.visible ? React.createElement(
      Native.View,
      null,
      React.createElement(Native.Text, null, `Answer project: ${props.projectName}`),
      React.createElement(Native.Text, null, props.loading ? 'Answer loading' : 'Answer settled'),
      props.answer ? React.createElement(Native.Text, null, props.answer.answer) : null,
      props.error ? React.createElement(Native.Text, null, props.error) : null,
      props.answer ? React.createElement(
        Native.Pressable,
        {
          accessibilityRole: 'button',
          accessibilityLabel: 'Open answer evidence',
          onPress: () => props.onOpenEvidence({
            sourceType: 'schedule',
            recordId: 'schedule-b',
            summary: 'B schedule proof',
          }),
        },
        React.createElement(Native.Text, null, 'Open answer evidence'),
      ) : null,
    ) : null;
  },
}));

const projects = [
  { id: 'project-a', name: 'Shared Name' },
  { id: 'project-b', name: 'Shared Name' },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function answer(text: string) {
  return { answer: text } as any;
}

function Probe({
  projectId,
  onOpenEvidence = jest.fn(),
}: {
  projectId: string;
  onOpenEvidence?: (projectId: string, projectName: string, evidence: any) => void;
}) {
  const experience = useECOSProjectQuestionExperience({
    contextualProjectId: projectId,
    contextualProjectName: 'Shared Name',
    projectRecords: projects,
    candidateProjects: ['Shared Name'],
    onOpenEvidence,
  });
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel="Open Ask ECOS" onPress={experience.open}>
      <Text>Open Ask ECOS</Text>
    </Pressable>
    {experience.sheets}
  </View>;
}

describe('mobile Ask ECOS immutable request identity', () => {
  beforeEach(() => {
    mockAskECOSProjectQuestion.mockReset();
    latestVoiceProps = null;
  });

  async function dismissCapture() {
    await act(async () => {
      latestVoiceProps?.onDismiss?.();
    });
  }

  async function submitAndDismissCapture() {
    fireEvent.press(screen.getByRole('button', { name: 'Submit project question' }));
    await dismissCapture();
  }

  it('waits for the native capture sheet to dismiss before opening the answer sheet', async () => {
    const pending = deferred<any>();
    mockAskECOSProjectQuestion.mockReturnValue(pending.promise);
    render(<Probe projectId="project-b" />);
    fireEvent.press(screen.getByRole('button', { name: 'Open Ask ECOS' }));
    fireEvent.press(screen.getByRole('button', { name: 'Submit project question' }));

    expect(mockAskECOSProjectQuestion).not.toHaveBeenCalled();
    expect(screen.queryByText('Answer loading')).toBeNull();

    await dismissCapture();
    expect(mockAskECOSProjectQuestion).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Answer loading')).toBeTruthy();

    await act(async () => pending.resolve(answer('B answer')));
    expect(screen.getByText('B answer')).toBeTruthy();
  });

  it('sends duplicate-name project B as B by immutable ID', async () => {
    mockAskECOSProjectQuestion.mockResolvedValue(answer('B answer'));
    render(<Probe projectId="project-b" />);
    fireEvent.press(screen.getByRole('button', { name: 'Open Ask ECOS' }));
    await submitAndDismissCapture();

    expect(mockAskECOSProjectQuestion).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-b',
      projectName: 'Shared Name',
      question: 'What needs attention?',
    }));
    expect(screen.getByText('B answer')).toBeTruthy();
  });

  it('opens same-name project B evidence with the captured immutable ID', async () => {
    const onOpenEvidence = jest.fn();
    mockAskECOSProjectQuestion.mockResolvedValue(answer('B answer'));
    render(<Probe projectId="project-b" onOpenEvidence={onOpenEvidence} />);
    fireEvent.press(screen.getByRole('button', { name: 'Open Ask ECOS' }));
    await submitAndDismissCapture();
    fireEvent.press(screen.getByRole('button', { name: 'Open answer evidence' }));

    expect(onOpenEvidence).toHaveBeenCalledWith(
      'project-b',
      'Shared Name',
      expect.objectContaining({ recordId: 'schedule-b' }),
    );
  });

  it('ignores late A success after the same question is submitted for B', async () => {
    const pendingA = deferred<any>();
    const pendingB = deferred<any>();
    mockAskECOSProjectQuestion
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);
    const view = render(<Probe projectId="project-a" />);
    fireEvent.press(screen.getByRole('button', { name: 'Open Ask ECOS' }));
    await submitAndDismissCapture();

    view.rerender(<Probe projectId="project-b" />);
    fireEvent.press(screen.getByRole('button', { name: 'Open Ask ECOS' }));
    await submitAndDismissCapture();
    await act(async () => pendingA.resolve(answer('stale A answer')));

    expect(screen.queryByText('stale A answer')).toBeNull();
    expect(screen.getByText('Answer loading')).toBeTruthy();

    await act(async () => pendingB.resolve(answer('current B answer')));
    expect(screen.getByText('current B answer')).toBeTruthy();
  });

  it('ignores a late A error and accepts the current B completion', async () => {
    const pendingA = deferred<any>();
    const pendingB = deferred<any>();
    mockAskECOSProjectQuestion
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);
    const view = render(<Probe projectId="project-a" />);
    fireEvent.press(screen.getByRole('button', { name: 'Open Ask ECOS' }));
    await submitAndDismissCapture();

    view.rerender(<Probe projectId="project-b" />);
    fireEvent.press(screen.getByRole('button', { name: 'Open Ask ECOS' }));
    await submitAndDismissCapture();
    await act(async () => pendingA.reject(new Error('stale A error')));

    expect(screen.queryByText('stale A error')).toBeNull();
    await act(async () => pendingB.resolve(answer('verified B answer')));
    expect(screen.getByText('verified B answer')).toBeTruthy();
  });
});
