import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DesktopAskECOSWorkspace } from '../../components/web-shell/desktop-ask-ecos';
import type { ECOSProjectQuestionAnswer } from '../../services/ECOSProjectQuestion';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function answer(projectId: string, text: string): ECOSProjectQuestionAnswer {
  return {
    schemaVersion: 'ecos-project-question/1.0',
    projectId,
    projectName: 'Shared Name',
    question: 'What needs attention?',
    answer: text,
    confidence: 'high',
    facts: [],
    limitations: [],
    conflicts: [],
    suggestedQuestions: [],
    supportingEvidence: [],
    assurance: {
      status: 'verified',
      checkedSourceCount: 1,
      verifiedFactCount: 1,
      rejectedFactCount: 0,
      message: 'Verified against exact project evidence.',
    },
    generatedAt: '2026-08-09T00:00:00.000Z',
    model: 'test-model',
  };
}

function submitQuestion() {
  fireEvent.changeText(
    screen.getByLabelText('Project question for ECOS'),
    'What needs attention?',
  );
  fireEvent.press(screen.getByRole('button', { name: 'Ask ECOS' }));
}

describe('desktop Ask ECOS request identity', () => {
  it('invalidates a pending response when the visible question is edited', async () => {
    const pending = deferred<ECOSProjectQuestionAnswer>();
    const onAsk = jest.fn().mockReturnValue(pending.promise);
    render(
      <DesktopAskECOSWorkspace projectId="project-a" projectName="Shared Name" onAsk={onAsk} />,
    );
    submitQuestion();

    fireEvent.changeText(
      screen.getByLabelText('Project question for ECOS'),
      'What is due next?',
    );
    await act(async () => pending.resolve(answer('project-a', 'stale Q1 answer')));

    expect(screen.queryByText('stale Q1 answer')).toBeNull();
    expect(screen.queryByText('ECOS is reviewing current project evidence…')).toBeNull();
    expect(screen.getByLabelText('Project question for ECOS')).toHaveProp(
      'value',
      'What is due next?',
    );
  });

  it('invalidates a pending error when an example replaces the visible question', async () => {
    const pending = deferred<ECOSProjectQuestionAnswer>();
    const onAsk = jest.fn().mockReturnValue(pending.promise);
    render(
      <DesktopAskECOSWorkspace projectId="project-a" projectName="Shared Name" onAsk={onAsk} />,
    );
    submitQuestion();

    fireEvent.press(screen.getByText('Which tasks are due next, and what proof supports that?'));
    await act(async () => pending.reject(new Error('stale Q1 error')));

    expect(screen.queryByText('stale Q1 error')).toBeNull();
    expect(screen.getByLabelText('Project question for ECOS')).toHaveProp(
      'value',
      'Which tasks are due next, and what proof supports that?',
    );
  });

  it('ignores late A success when the global project changes to same-name B', async () => {
    const pendingA = deferred<ECOSProjectQuestionAnswer>();
    const pendingB = deferred<ECOSProjectQuestionAnswer>();
    const onAsk = jest.fn()
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);
    const view = render(
      <DesktopAskECOSWorkspace projectId="project-a" projectName="Shared Name" onAsk={onAsk} />,
    );
    submitQuestion();

    view.rerender(
      <DesktopAskECOSWorkspace projectId="project-b" projectName="Shared Name" onAsk={onAsk} />,
    );
    submitQuestion();
    expect(onAsk).toHaveBeenLastCalledWith({
      projectId: 'project-b',
      projectName: 'Shared Name',
      question: 'What needs attention?',
    });

    await act(async () => pendingA.resolve(answer('project-a', 'stale A answer')));
    expect(screen.queryByText('stale A answer')).toBeNull();
    expect(screen.getByText('ECOS is reviewing current project evidence…')).toBeTruthy();

    await act(async () => pendingB.resolve(answer('project-b', 'current B answer')));
    expect(screen.getByText('current B answer')).toBeTruthy();
    expect(screen.getByText('QUESTION ANSWERED')).toBeTruthy();
    expect(screen.getByText('What needs attention?')).toBeTruthy();
  });

  it('ignores late A error and accepts the legitimate current B response', async () => {
    const pendingA = deferred<ECOSProjectQuestionAnswer>();
    const pendingB = deferred<ECOSProjectQuestionAnswer>();
    const onAsk = jest.fn()
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);
    const view = render(
      <DesktopAskECOSWorkspace projectId="project-a" projectName="Shared Name" onAsk={onAsk} />,
    );
    submitQuestion();
    view.rerender(
      <DesktopAskECOSWorkspace projectId="project-b" projectName="Shared Name" onAsk={onAsk} />,
    );
    submitQuestion();

    await act(async () => pendingA.reject(new Error('stale A error')));
    expect(screen.queryByText('stale A error')).toBeNull();
    await act(async () => pendingB.resolve(answer('project-b', 'verified B answer')));
    expect(screen.getByText('verified B answer')).toBeTruthy();
  });
});
