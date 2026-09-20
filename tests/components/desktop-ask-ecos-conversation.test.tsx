import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DesktopAskECOSWorkspace } from '../../components/web-shell/desktop-ask-ecos';

jest.mock('expo-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '55555555-5555-4555-8555-555555555555' }));
const turnId = '11111111-1111-4111-8111-111111111111';
// aiReadStatements is required by ECOSProjectQuestionAnswer and normalized by
// parseAIReadStatements for every real answer, so the desktop panel reads it
// unguarded. This fixture omitted it and the `as never` cast hid that from the
// compiler, so the panel threw on undefined.length and unmounted — a red suite
// nobody saw, because qa:release cannot run (its Ask ECOS evidence layer needs a
// gitignored file under 24h old). Keep every required field present here; the
// cast cannot be relied on to catch the next addition.
const answer = (request: any) => ({
  answer: 'Test answer, not project accuracy evidence.', facts: [], limitations: [], conflicts: [],
  confidence: 'low', supportingEvidence: [], suggestedQuestions: [], aiReadStatements: [],
  assurance: { status: 'insufficient_evidence', message: 'Test only' },
  conversation: { conversationId: request.conversationId, turnId, priorTurnId: request.priorTurnId || null },
}) as never;

it('carries the prior server turn when the user types a follow-up in the normal desktop controls', async () => {
  const onAsk = jest.fn(async input => answer(input));
  const screen = render(<DesktopAskECOSWorkspace ownerKey="owner" projectId="project-one" projectName="Project One" onAsk={onAsk} />);
  fireEvent.changeText(screen.getByLabelText('Project question for ECOS'), 'What is the square footage of canopy B?');
  await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
  await screen.findByText('Test answer, not project accuracy evidence.');
  fireEvent.changeText(screen.getByLabelText('Project question for ECOS'), 'And canopy C?');
  // Both presses are wrapped: onAsk resolves asynchronously and the component
  // then sets state, so waiting only on the mock call count leaves that update
  // outside act(). The strict Jest gate treats an act() warning as a failure,
  // which is right — an unwrapped update means the test asserted on a tree that
  // React had not finished committing.
  await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
  await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(2));
  expect(onAsk.mock.calls[1][0]).toEqual({ projectId: 'project-one', projectName: 'Project One',
    question: 'And canopy C?', conversationId: onAsk.mock.calls[0][0].conversationId, priorTurnId: turnId });
});

it.each(['project', 'owner'])('clears the desktop result and drops a late answer after a %s switch', async kind => {
  let finish!: (value: never) => void;
  const onAsk = jest.fn(() => new Promise<never>(resolve => { finish = resolve; }));
  const screen = render(<DesktopAskECOSWorkspace ownerKey="owner" projectId="one" projectName="Project One" onAsk={onAsk} />);
  fireEvent.changeText(screen.getByLabelText('Project question for ECOS'), 'What work remains?');
  fireEvent.press(screen.getByText('Ask ECOS'));
  screen.rerender(<DesktopAskECOSWorkspace ownerKey={kind === 'owner' ? 'other' : 'owner'} projectId={kind === 'project' ? 'two' : 'one'} projectName="Project One" onAsk={onAsk} />);
  await act(async () => finish(answer({ conversationId: '55555555-5555-4555-8555-555555555555' })));
  expect(screen.queryByText('Test answer, not project accuracy evidence.')).toBeNull();
  expect(screen.getByLabelText('Project question for ECOS').props.value).toBe('');
});
