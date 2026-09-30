import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';

import { DAVECaptureConfirmationSheet } from '../../components/DAVECaptureConfirmationSheet';
import { FieldNotesWorkspace } from '../../components/field-notes-workspace';
import { NativeFieldNotesExperience } from '../../components/native-field-notes-experience';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { useKeptTalkCapture } from '../../hooks/use-kept-talk-capture';
import {
  confirmCaptureLocation,
  correctCaptureMemory,
  createCaptureMemory,
} from '../../services/DAVECaptureMemory';

// Whole-app audit round 2 lows in voice and field capture (30 Sep 2026):
// A9 F5, A11 pass 2 #2, A11 pass 1 F8, F9 and F10. Synthetic data only.

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock('../../services/FieldNoteMobileSync', () => ({
  mobileFieldNoteDataSource: {
    list: jest.fn(async () => []),
    save: jest.fn(async (_ownerKey: string, note: unknown) => note),
    update: jest.fn(async (_ownerKey: string, note: unknown) => note),
  },
}));
jest.mock('../../services/FieldNoteRepository', () => {
  const actual = jest.requireActual('../../services/FieldNoteRepository');
  return {
    ...actual,
    localFieldNoteRepository: {
      list: jest.fn(async () => []),
      save: jest.fn(async (_ownerKey: string, note: unknown) => note),
      replace: jest.fn(async (_ownerKey: string, note: unknown) => note),
    },
  };
});
// The real sheet records audio; this stand-in shows what it was given and
// offers its "Type Instead" exit.
const mockVoiceSheetProps: { projectName?: string; contextLabel?: string }[] = [];
jest.mock('../../components/DAVEVoiceCaptureSheet', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    DAVEVoiceCaptureSheet: (props: {
      visible: boolean; projectName: string; contextLabel?: string; onTypeInstead: () => void;
    }) => {
      if (!props.visible) return null;
      mockVoiceSheetProps.push({ projectName: props.projectName, contextLabel: props.contextLabel });
      return React.createElement(Pressable, {
        accessibilityRole: 'button', accessibilityLabel: 'Type instead', onPress: props.onTypeInstead,
      }, React.createElement(Text, null, 'Type Instead'));
    },
  };
});

const P2321 = '2321 Compliance Project';
const P2375 = '2375 Compliance Project';
const AREAS: Record<string, string[]> = {
  [P2321]: ['Level 2 corridor', 'Roof'],
  [P2375]: ['North Lot'],
};

function memoryDraft(location: string | null = 'Level 2 corridor') {
  return createCaptureMemory({
    id: 'memory-f5',
    transcript: 'Drywall crew finishes Friday.',
    transcriptSourceRecordId: 'typed-entry:memory-f5',
    createdAt: '2026-09-30T12:00:00.000Z',
    recommendedProject: { value: P2321, confidence: 'high', confirmed: true },
    recommendedLocation: { value: location, confidence: 'high', confirmed: false },
    fields: { generalMemory: 'Drywall crew finishes Friday.' },
  });
}

describe('A9 F5: Confirm Memory offers the chosen project areas', () => {
  function renderSheet(draft = memoryDraft()) {
    const onSave = jest.fn();
    const screen = render(
      <DAVECaptureConfirmationSheet
        visible
        transcript={draft.transcript}
        draft={draft}
        projects={[P2321, P2375]}
        locationsForProject={project => AREAS[project || ''] || []}
        onSave={onSave}
        onCancel={() => undefined}
      />,
    );
    return { ...screen, onSave };
  }

  it('switching the project swaps the area list and drops the other project area', async () => {
    const screen = renderSheet();
    expect(screen.getByText('Roof')).toBeTruthy();
    fireEvent.press(screen.getByText(P2375));
    expect(screen.queryByText('Roof')).toBeNull();
    expect(screen.getByText('North Lot')).toBeTruthy();
    expect(screen.getByText('No location recommended')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Save confirmed memory'));
    await waitFor(() => expect(screen.onSave).toHaveBeenCalledTimes(1));
    expect(screen.onSave.mock.calls[0][0].recommendedProject.value).toBe(P2375);
    expect(screen.onSave.mock.calls[0][0].recommendedLocation.value).toBeNull();
  });

  it('a confirmed area the new project does not have is dropped too', async () => {
    const screen = renderSheet();
    fireEvent.press(screen.getByText('Confirm Level 2 corridor'));
    fireEvent.press(screen.getByText(P2375));
    expect(screen.getByText('No location recommended')).toBeTruthy();
  });

  it('the memory service clears an unconfirmed location when the project changes and keeps a confirmed one', () => {
    const moved = correctCaptureMemory(memoryDraft(), 'project', P2375, '2026-09-30T12:01:00.000Z');
    expect(moved.recommendedLocation).toMatchObject({ value: null, confirmed: false });
    const confirmed = confirmCaptureLocation(memoryDraft());
    const kept = correctCaptureMemory(confirmed, 'project', P2375, '2026-09-30T12:01:00.000Z');
    expect(kept.recommendedLocation).toMatchObject({ value: 'Level 2 corridor', confirmed: true });
    const same = correctCaptureMemory(memoryDraft(), 'project', P2321, '2026-09-30T12:01:00.000Z');
    expect(same.recommendedLocation.value).toBe('Level 2 corridor');
  });
});

describe('A11 pass 2 #2: dictation after closing an unsaved field note', () => {
  const renderWorkspace = (ownerKey: string, voiceDraft: { id: string; text: string } | null) => (
    <FieldNotesWorkspace
      ownerKey={ownerKey}
      projects={[P2321]}
      voiceDraft={voiceDraft ? { ...voiceDraft, projectName: null, locationName: null } : null}
    />
  );

  it('reopens the closed note with the words added and says so', async () => {
    const screen = render(renderWorkspace('owner-closed', null));
    fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
    fireEvent.changeText(screen.getByLabelText('Field note'), 'Crack in the east wall');
    fireEvent.press(screen.getByRole('button', { name: 'Close field note editor' }));
    expect(screen.queryByLabelText('Field note')).toBeNull();
    screen.rerender(renderWorkspace('owner-closed', { id: 'voice-closed', text: 'near the stair.' }));
    await waitFor(() => expect(screen.getByDisplayValue('Crack in the east wall near the stair.')).toBeTruthy());
    expect(screen.getByText('Added to your unsaved note. Review it, then save.')).toBeTruthy();
  });

  it('adds to a note still open without the unsaved-note warning', async () => {
    const screen = render(renderWorkspace('owner-open', null));
    fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
    fireEvent.changeText(screen.getByLabelText('Field note'), 'Crack in the east wall');
    screen.rerender(renderWorkspace('owner-open', { id: 'voice-open', text: 'near the stair.' }));
    await waitFor(() => expect(screen.getByDisplayValue('Crack in the east wall near the stair.')).toBeTruthy());
    expect(screen.getByText('Voice note is ready. Review it, then save.')).toBeTruthy();
  });
});

describe('A11 pass 1 F8: a failing panel keeps an unconfirmed Talk memory', () => {
  it('closes the sheet, keeps the memory, and brings it back on the next Talk', () => {
    const hook = renderHook(({ draft }: { draft: { id: string } | null }) => useKeptTalkCapture(draft), {
      initialProps: { draft: { id: 'memory-1' } as { id: string } | null },
    });
    expect(hook.result.current.sheetDraft?.id).toBe('memory-1');
    act(() => hook.result.current.keep());
    expect(hook.result.current.sheetDraft).toBeNull();
    let reopened = false;
    act(() => { reopened = hook.result.current.reopen(); });
    expect(reopened).toBe(true);
    expect(hook.result.current.sheetDraft?.id).toBe('memory-1');
    expect(hook.result.current.reopen()).toBe(false);
    act(() => hook.result.current.keep());
    hook.rerender({ draft: { id: 'memory-2' } });
    expect(hook.result.current.sheetDraft?.id).toBe('memory-2');
  });

  it('dismissing every overlay keeps the memory, and Talk reopens it', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    const dismiss = app.slice(app.indexOf('function dismissAllOverlays()'));
    const body = dismiss.slice(0, dismiss.indexOf('\n  }\n'));
    expect(body).not.toContain('setTalkCaptureDraft(null)');
    expect(body).toContain('keptTalkCapture.keep()');
    expect(app).toContain('if (keptTalkCapture.reopen()) return;');
    expect(app).toMatch(/\{talkCaptureSheetDraft \? \(\s*<DAVECaptureConfirmationSheet/);
  });
});

describe('A11 pass 1 F9: a Talk history read failure keeps the words', () => {
  // Since the A9 pass 2 fix (72e8def) Talk reads no saved history at all
  // ("previous answer" = this Talk session), so no failed read can stop Talk
  // and lose the words of a recording that is already deleted.
  it('never reads saved history, so a failed read cannot drop the transcript', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).not.toContain('talkHistoryPersistence.read(');
    expect(app).not.toContain('Talk history unavailable');
    expect(app).toContain('const history = talkSession.history();');
  });
});

describe('A11 pass 1 F10: Field Notes voice exits', () => {
  const PROJECT_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
  function renderNotes() {
    return render(
      <NativeWorkspaceOwnerContext.Provider value="owner-f10">
        <NativeFieldNotesExperience
          contentStyle={undefined}
          projects={[P2321]}
          projectRecords={[{ id: PROJECT_ID, name: P2321 }]}
          projectAreas={[]}
        />
      </NativeWorkspaceOwnerContext.Provider>,
    );
  }

  it('Type Instead opens the typed editor, and a General note is described as general', async () => {
    mockVoiceSheetProps.length = 0;
    const screen = renderNotes();
    expect(screen.queryByLabelText('Field note')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Record field note' }));
    expect(mockVoiceSheetProps.at(-1)).toEqual({ projectName: 'General field note', contextLabel: 'General field note' });
    fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
    await waitFor(() => expect(screen.getByLabelText('Field note')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Type instead' })).toBeNull();
  });
});
