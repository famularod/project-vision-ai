/**
 * Whole-app audit A2 M3: the field note being written is kept outside the
 * screen until Save, for one owner, and forgotten on an account change.
 */
import { act, renderHook } from '@testing-library/react-native';
import {
  forgetFieldNoteDraft,
  useFieldNoteDraft,
  type FieldNoteDraft,
} from '../../hooks/use-field-note-draft';

const empty = (projectName = ''): FieldNoteDraft => ({
  text: '', source: 'typed', projectName, locationName: '', actionKind: 'none', actionText: '', captureOpen: false,
});

describe('field note draft (audit A2 M3)', () => {
  afterEach(() => forgetFieldNoteDraft());

  it('survives the screen going away and coming back', async () => {
    const first = await renderHook(() => useFieldNoteDraft('mobile_capture:owner-a', empty()));
    await act(async () => {
      first.result.current[1]('captureOpen', true);
      first.result.current[1]('text', 'Guardrail missing');
    });
    await first.unmount();
    const again = await renderHook(() => useFieldNoteDraft('mobile_capture:owner-a', empty('Other Project')));
    expect(again.result.current[0]).toMatchObject({ text: 'Guardrail missing', captureOpen: true, projectName: '' });
    await again.unmount();
  });

  it("starts from the screen's own values when nothing is being written", async () => {
    const hook = await renderHook(() => useFieldNoteDraft('mobile_capture:owner-a', empty('2375 Compliance Project')));
    expect(hook.result.current[0]).toEqual(empty('2375 Compliance Project'));
    await hook.unmount();
  });

  it("never shows one owner's note to another, and forgets it on an account change", async () => {
    const ownerA = await renderHook(() => useFieldNoteDraft('mobile_capture:owner-a', empty()));
    await act(async () => { ownerA.result.current[1]('text', 'Owner A private'); });
    await ownerA.unmount();
    const ownerB = await renderHook(() => useFieldNoteDraft('mobile_capture:owner-b', empty()));
    expect(ownerB.result.current[0].text).toBe('');
    await ownerB.unmount();
    const ownerAAgain = await renderHook(() => useFieldNoteDraft('mobile_capture:owner-a', empty()));
    expect(ownerAAgain.result.current[0].text).toBe('');
    await act(async () => { ownerAAgain.result.current[1]('text', 'Owner A again'); });
    await act(async () => { forgetFieldNoteDraft(); });
    expect(ownerAAgain.result.current[0].text).toBe('');
    await ownerAAgain.unmount();
  });
});
