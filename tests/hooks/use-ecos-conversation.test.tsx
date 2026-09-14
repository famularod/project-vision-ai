import { act, renderHook } from '@testing-library/react-native';
import { useECOSConversation } from '../../hooks/use-ecos-conversation';
jest.mock('expo-crypto', () => ({ randomUUID: () => '55555555-5555-4555-8555-555555555555' }));

const turnId = '11111111-1111-4111-8111-111111111111';

it('uses server turn IDs, never a previous answer, as follow-up context', () => {
  const { result } = renderHook(() => useECOSConversation('owner/project-one'));
  const first = result.current.begin();
  first.accept({ conversationId: first.request.conversationId, turnId, priorTurnId: null });
  const followUp = result.current.begin();
  expect(followUp.request).toEqual({ conversationId: first.request.conversationId, priorTurnId: turnId });
  expect(first.isCurrent()).toBe(false);
});

it.each(['owner-two/project-one', 'owner-one/project-two'])('discards history and late responses when scope becomes %s', scope => {
  const { result, rerender } = renderHook<ReturnType<typeof useECOSConversation>, { selected: string }>(({ selected }) => useECOSConversation(selected), {
    initialProps: { selected: 'owner-one/project-one' },
  });
  const first = result.current.begin();
  act(() => rerender({ selected: scope }));
  expect(first.isCurrent()).toBe(false);
  first.accept({ conversationId: first.request.conversationId, turnId, priorTurnId: null });
  expect(result.current.begin().request.priorTurnId).toBeUndefined();
  act(() => rerender({ selected: 'owner-one/project-one' }));
  expect(result.current.begin().request.priorTurnId).toBeUndefined();
});

it('invalidates a pending turn on unmount', () => {
  const { result, unmount } = renderHook(() => useECOSConversation('scope'));
  const pending = result.current.begin();
  unmount();
  expect(pending.isCurrent()).toBe(false);
});

it('clears prior context after an invalid receipt or failed request', () => {
  const { result } = renderHook(() => useECOSConversation('scope'));
  const first = result.current.begin();
  first.accept({ conversationId: first.request.conversationId, turnId, priorTurnId: null });
  result.current.begin().accept(null);
  expect(result.current.begin().request.priorTurnId).toBeUndefined();
});
