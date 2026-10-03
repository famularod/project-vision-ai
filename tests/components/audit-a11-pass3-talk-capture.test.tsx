import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DAVECaptureConfirmationSheet } from '../../components/DAVECaptureConfirmationSheet';
import { NativeFieldNotesExperience } from '../../components/native-field-notes-experience';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { OverlayErrorBoundary } from '../../components/overlay-error-boundary';
import { useKeptTalkCapture } from '../../hooks/use-kept-talk-capture';
import { createCaptureMemory, type DAVECaptureMemory } from '../../services/DAVECaptureMemory';
import { fieldNoteVoiceUnavailable } from '../../services/FieldNoteVoiceContext';

// Whole-app audit A11 pass 3 (30 Sep 2026), Talk and voice lows. Synthetic data only.

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../../services/StartupDiagnostics', () => ({
  logStartupDiagnostic: jest.fn(),
  startupErrorMessage: (error: Error) => error.message,
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
jest.mock('../../components/DAVEVoiceCaptureSheet', () => ({
  DAVEVoiceCaptureSheet: () => null,
}));

const P2321 = '2321 Compliance Project';
const P2375 = '2375 Compliance Project';
const WORDS = 'Guardrail missing at the roof edge.';
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

function memoryDraft(): DAVECaptureMemory {
  return createCaptureMemory({
    id: 'talk-memory-1',
    transcript: WORDS,
    transcriptSourceRecordId: 'typed-entry:talk-memory-1',
    createdAt: '2026-09-30T12:00:00.000Z',
    recommendedProject: { value: P2321, confidence: 'high', confirmed: true },
    recommendedLocation: { value: null, confidence: 'unknown', confirmed: false },
    fields: { generalMemory: WORDS },
  });
}

function Broken(): never {
  throw new Error('panel render failed');
}

/**
 * App's overlays in miniature: the Confirm Memory sheet beside another panel,
 * inside the real OverlayErrorBoundary whose onError closes the panels and
 * keeps the memory (dismissAllOverlays).
 */
function TalkOverlays({ onSave, sheetBroken = false }: {
  onSave: (memory: DAVECaptureMemory) => void; sheetBroken?: boolean;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<DAVECaptureMemory | null>(memoryDraft);
  const [talkOpened, setTalkOpened] = useState(0);
  const kept = useKeptTalkCapture(draft);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Open panel" onPress={() => setPanelOpen(true)} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Talk"
        onPress={() => { if (!kept.reopen()) setTalkOpened(count => count + 1); }}
      />
      <Text>{`Talk opened ${talkOpened}`}</Text>
      <OverlayErrorBoundary screen="Home" onError={() => { setPanelOpen(false); kept.keep(); }}>
        {panelOpen ? <Broken /> : null}
        {kept.sheetDraft ? (
          sheetBroken ? <Broken /> : (
            <DAVECaptureConfirmationSheet
              visible
              transcript={kept.sheetDraft.transcript}
              draft={kept.sheetDraft}
              projects={[P2321, P2375]}
              onSave={async memory => { onSave(memory); setDraft(null); }}
              onCancel={() => setDraft(null)}
              onWorkingChange={kept.track}
            />
          )
        ) : null}
      </OverlayErrorBoundary>
    </>
  );
}

beforeEach(() => {
  alert.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.mocked(console.error).mockRestore());

describe('A11 pass 3: a kept Talk memory comes back as the owner left it', () => {
  it('a memory moved to 2375 reopens under 2375 after a panel fails, and saves there', async () => {
    const onSave = jest.fn();
    const screen = render(<TalkOverlays onSave={onSave} />);
    fireEvent.press(screen.getByText(P2375));
    fireEvent.changeText(screen.getByDisplayValue(WORDS), 'Guardrail missing at the roof edge, east side.');
    fireEvent.press(screen.getByRole('button', { name: 'Open panel' }));
    expect(screen.queryByText('Confirm Memory')).toBeNull();
    expect(alert).toHaveBeenCalledWith('That panel could not open.', expect.any(String));

    fireEvent.press(screen.getByRole('button', { name: 'Talk' }));
    expect(screen.getByText('Confirm Memory')).toBeTruthy();
    expect(screen.getByText(P2375)).toBeTruthy();
    expect(screen.getByText(P2321)).toBeTruthy(); // offered as the other choice, no longer the pick
    expect(screen.getByDisplayValue('Guardrail missing at the roof edge, east side.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Save confirmed memory'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].recommendedProject).toMatchObject({ value: P2375, confirmed: true });
    expect(onSave.mock.calls[0][0].fields.generalMemory).toBe('Guardrail missing at the roof edge, east side.');
  });

  it('a Confirm Memory sheet that fails twice is given up: Talk says so once, offers the words, then records again', async () => {
    const screen = render(<TalkOverlays onSave={jest.fn()} sheetBroken />);
    // First failure: the memory is kept and Talk reopens it.
    expect(alert).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Talk' }));
    // Second failure: given up.
    expect(alert).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Talk opened 0')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Talk' }));
    expect(alert).toHaveBeenCalledTimes(3);
    const [title, message, buttons] = alert.mock.calls[2] as [string, string, { text: string; onPress?: () => void }[]];
    expect(title).toBe('That memory could not reopen');
    expect(message).toContain(`“${WORDS}”`);
    expect(message).toContain('was not saved');
    act(() => buttons.find(button => button.text === 'Copy Words')!.onPress!());
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(WORDS);
    expect(screen.getByText('Talk opened 0')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Talk' }));
    expect(screen.getByText('Talk opened 1')).toBeTruthy();
    expect(alert).toHaveBeenCalledTimes(3);
  });

  it('App hands the Talk Confirm Memory sheet its working-copy tracker', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    const sheet = app.slice(app.indexOf('{talkCaptureSheetDraft ? ('));
    expect(sheet.slice(0, sheet.indexOf(') : null}'))).toContain('onWorkingChange={keptTalkCapture.track}');
  });
});

describe('A11 pass 3: voice for a project that has not reached the cloud', () => {
  it('says why, instead of "still loading", and offers to type the note', async () => {
    const screen = render(
      <NativeWorkspaceOwnerContext.Provider value="owner-p3">
        <NativeFieldNotesExperience
          contentStyle={undefined}
          projects={[P2321]}
          projectRecords={[{ name: P2321 }]}
          projectAreas={[]}
        />
      </NativeWorkspaceOwnerContext.Provider>,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Record field note' }));
    const [title, message, buttons] = alert.mock.calls.at(-1) as [string, string, { text: string; onPress?: () => void }[]];
    expect(`${title} ${message}`).not.toMatch(/loading/i);
    expect(message).toMatch(/reached the cloud/);
    act(() => buttons.find(button => button.text === 'Type Note')!.onPress!());
    await waitFor(() => expect(screen.getByLabelText('Field note')).toBeTruthy());
  });

  it('names the project when there is one, and never says loading', () => {
    const named = fieldNoteVoiceUnavailable(P2321);
    expect(named.message).toContain(`${P2321} hasn't reached the cloud yet`);
    const general = fieldNoteVoiceUnavailable(null);
    expect(general.message).toMatch(/No project has reached the cloud yet/);
    expect(JSON.stringify([named, general])).not.toMatch(/loading/i);
  });
});
