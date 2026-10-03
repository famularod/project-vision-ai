/**
 * Whole-app audit A2 M3: the field note being written is kept outside the
 * screen until Save, for one owner, and forgotten on an account change.
 */
import { act, renderHook } from '@testing-library/react-native';
// The draft is also kept in phone storage for an account (A11 pass 4 L3,
// tests/hooks/use-field-note-draft-kept.test.tsx); these tests keep none.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiRemove: jest.fn(async () => undefined),
}));
import {
  clearFieldNoteDraftIfUnchanged,
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

  // Audit A4 pass 6: after one note was saved for Project A, every later visit
  // started with Project A selected (the mic included) until sign-out.
  it("a saved note's project does not stick to the next visit; a chosen project stays while writing", async () => {
    const visit = await renderHook(() => useFieldNoteDraft('mobile_capture:owner-a', empty()));
    await act(async () => {
      visit.result.current[1]('projectName', 'Project A');
      visit.result.current[1]('text', 'Pour scheduled');
    });
    // Save clears the written fields; the project stays for this visit.
    await act(async () => { visit.result.current[1]('text', ''); });
    expect(visit.result.current[0].projectName).toBe('Project A');
    await visit.unmount();
    const next = await renderHook(() => useFieldNoteDraft('mobile_capture:owner-a', empty()));
    expect(next.result.current[0]).toEqual(empty());
    await next.unmount();
  });

  // Audit A11 pass 1 F7: a save that finished after the owner left kept the
  // saved text in the box, and a second Save filed it twice.
  it('a save finishing after leave clears an unchanged draft, and keeps one edited since', async () => {
    const key = 'mobile_capture:owner-f7';
    const first = await renderHook(() => useFieldNoteDraft(key, empty()));
    await act(async () => { first.result.current[1]('text', 'Pour at 7'); });
    await first.unmount();
    await act(async () => {
      clearFieldNoteDraftIfUnchanged(key, { text: 'Pour at 7', locationName: '', actionKind: 'none', actionText: '' });
    });
    const back = await renderHook(() => useFieldNoteDraft(key, empty()));
    expect(back.result.current[0].text).toBe('');
    await act(async () => { back.result.current[1]('text', 'A new note'); });
    await act(async () => {
      clearFieldNoteDraftIfUnchanged(key, { text: 'Pour at 7', locationName: '', actionKind: 'none', actionText: '' });
      clearFieldNoteDraftIfUnchanged('mobile_capture:someone-else', { text: 'A new note', locationName: '', actionKind: 'none', actionText: '' });
    });
    expect(back.result.current[0].text).toBe('A new note');
    await back.unmount();
  });

  it('F7 is wired where a save finishes after the screen was left', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const workspace = fs.readFileSync(path.resolve(__dirname, '../../components/field-notes-workspace.tsx'), 'utf8');
    expect(workspace).toMatch(/if \(operation !== noteOperationRef\.current\) \{\n\s+clearFieldNoteDraftIfUnchanged\(draftKey, \{ text, locationName, actionKind, actionText \}\);\n\s+return;/);
  });
});

