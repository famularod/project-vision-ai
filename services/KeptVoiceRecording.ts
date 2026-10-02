import * as FileSystem from 'expo-file-system/legacy';

import { forgetKeptDrafts, keepDraft, keptDraftScopes, readKeptDraft } from './KeptDraftStore';

/**
 * Everyday item 4 (2 Oct 2026): a recording waiting for signal survives iOS
 * closing the app. It was kept in the voice sheet only (A11 pass 6 L2): the
 * audio sat in the recorder's cache folder and its pending state in memory,
 * so a closed app lost the dictation. Now its audio is moved into the app's
 * documents folder and its entry kept with the other unsaved drafts
 * (KeptDraftStore), per account and per sheet (`slot`); the sheet offers it,
 * and tries it again, the next time it opens for that account.
 *
 * Only the file name is kept: iOS can move the app's folders on an update, so
 * the path is rebuilt from the documents folder when the entry is read.
 */
export type KeptVoiceRecording = Readonly<{
  uri: string;
  durationMs: number;
  projectId: string | null;
  projectName: string;
  keptAt: string;
}>;

type KeptVoiceRecordingEntry = Readonly<{
  fileName: string;
  durationMs: number;
  projectId: string | null;
  projectName: string;
}>;

const KEPT_RECORDINGS_FOLDER = 'kept-recordings';

function keptFolder(): string | null {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${KEPT_RECORDINGS_FOLDER}/` : null;
}

function keptUri(fileName: string): string | null {
  const folder = keptFolder();
  return folder && /^[\w.-]+\.m4a$/.test(fileName) ? `${folder}${fileName}` : null;
}

/** Whether `uri` is a recording already kept in the documents folder. */
export function isKeptVoiceRecordingUri(uri: string | null | undefined): boolean {
  const folder = keptFolder();
  return Boolean(folder && uri && uri.startsWith(folder));
}

async function fileExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return Boolean(info.exists) && (typeof (info as { size?: unknown }).size !== 'number' || (info as { size: number }).size > 0);
  } catch {
    return false;
  }
}

/**
 * Keeps `recording` for this account and sheet: a copy of its audio in the
 * documents folder (out of the cache, which iOS may clear), and its entry.
 * The sheet keeps using the original while it is open: an upload it stopped
 * waiting for may still be reading it, and its words are held for it (A11
 * pass 4 M1). Resolves to the kept copy's address; rejects when it could not
 * be kept (the recording then stays kept in the sheet only, as before).
 */
export async function keepVoiceRecording(
  ownerKey: string,
  slot: string,
  recording: Readonly<{ uri: string; durationMs: number; projectId: string | null; projectName: string }>,
): Promise<string> {
  const folder = keptFolder();
  if (!folder) throw new Error('The recording could not be kept on this device.');
  let uri = recording.uri;
  if (!isKeptVoiceRecordingUri(uri)) {
    await FileSystem.makeDirectoryAsync(folder, { intermediates: true }).catch(() => undefined);
    const target = `${folder}recording-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}.m4a`;
    await FileSystem.copyAsync({ from: uri, to: target });
    if (!await fileExists(target)) throw new Error('The recording could not be kept on this device.');
    uri = target;
  }
  const entry: KeptVoiceRecordingEntry = {
    fileName: uri.slice(folder.length),
    durationMs: Math.max(0, Math.round(recording.durationMs)),
    projectId: recording.projectId?.trim() || null,
    projectName: recording.projectName,
  };
  await keepDraft('voice-recording', ownerKey, slot, entry);
  return uri;
}

/** The recording kept for this account and sheet, or null; an entry whose audio is gone is removed. */
export async function readKeptVoiceRecording(ownerKey: string, slot: string): Promise<KeptVoiceRecording | null> {
  const kept = await readKeptDraft('voice-recording', ownerKey, slot);
  const entry = kept?.value as Partial<KeptVoiceRecordingEntry> | undefined;
  if (!kept || !entry || typeof entry.fileName !== 'string' || typeof entry.projectName !== 'string') return null;
  const uri = keptUri(entry.fileName);
  if (!uri || !await fileExists(uri)) {
    await keepDraft('voice-recording', ownerKey, slot, null);
    return null;
  }
  return Object.freeze({
    uri,
    durationMs: typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs) ? entry.durationMs : 0,
    projectId: typeof entry.projectId === 'string' ? entry.projectId : null,
    projectName: entry.projectName,
    keptAt: kept.keptAt,
  });
}

/** The recording was used or discarded: its entry and, when kept, its audio go. */
export async function forgetKeptVoiceRecording(ownerKey: string, slot: string, uri?: string | null): Promise<void> {
  await keepDraft('voice-recording', ownerKey, slot, null);
  if (uri && isKeptVoiceRecordingUri(uri)) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

/** Whether this account has a recording kept on this device (the Sign Out warning names it). */
export async function keptVoiceRecordingExists(ownerKey: string): Promise<boolean> {
  for (const slot of await keptDraftScopes('voice-recording', ownerKey)) {
    if (await readKeptVoiceRecording(ownerKey, slot)) return true;
  }
  return false;
}

/** Account change or sign-out, as for the other unsaved drafts: every kept recording goes. */
export function forgetKeptVoiceRecordings(): void {
  void forgetKeptDrafts('voice-recording');
  const folder = keptFolder();
  if (folder) void FileSystem.deleteAsync(folder, { idempotent: true }).catch(() => undefined);
}
