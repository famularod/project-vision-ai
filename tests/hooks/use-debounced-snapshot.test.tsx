import { act, renderHook } from '@testing-library/react-native';
import { useDebouncedSnapshot } from '../../hooks/use-debounced-snapshot';

describe('useDebouncedSnapshot', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('coalesces rapid same-scope edits and commits only the latest value', async () => {
    type Props = { value: string; signature: string };
    const { result, rerender } = await renderHook(
      ({ value, signature }: Props) => useDebouncedSnapshot({
        value,
        signature,
        priorityKey: 'project-1',
        delayMs: 500,
      }),
      { initialProps: { value: 'initial', signature: 'initial' } },
    );

    await rerender({ value: 'n', signature: 'n' });
    await rerender({ value: 'no', signature: 'no' });
    await rerender({ value: 'note', signature: 'note' });

    expect(result.current.value).toBe('initial');
    await act(() => jest.advanceTimersByTime(499));
    expect(result.current.value).toBe('initial');
    await act(() => jest.advanceTimersByTime(1));
    expect(result.current.value).toBe('note');
  });

  it('commits project or surface changes immediately', async () => {
    type Props = { value: string; signature: string; priorityKey: string };
    const { result, rerender } = await renderHook(
      ({ value, signature, priorityKey }: Props) => useDebouncedSnapshot({
        value,
        signature,
        priorityKey,
        delayMs: 500,
      }),
      {
        initialProps: {
          value: 'project one',
          signature: 'project-one-v1',
          priorityKey: 'project-1',
        },
      },
    );

    await rerender({
      value: 'project two',
      signature: 'project-two-v1',
      priorityKey: 'project-2',
    });

    expect(result.current.value).toBe('project two');
  });
});
