import * as FileSystem from 'expo-file-system/legacy';

import type { DAVEProjectWalkContext } from './DAVEProjectWalk';
import { forgetKeptDrafts, keepDraft, keptDraftScopes, keptDraftsOnDevice, readKeptDraft } from './KeptDraftStore';

/**
 * Everyday item 4 (2 Oct 2026): a recording waiting for signal survives iOS
 * closing the app. It was kept in the voice sheet only (A11 pass 6 L2): the
 * audio sat in the recorder's cache folder and its pending state in memory,
 * so a closed app lost the dictation. Now its audio is moved into the app's
 * documents folder and its entry kept with the other unsaved drafts
 * (KeptDraftStore), per account; the sheet (`slot`) offers it, and tries it
 * again, the next time it opens for that account and the recording's project.
 *
 * Review N1 M1 (2 Oct 2026): one entry per RECORDING. There was one entry per
 * sheet, so the same sheet keeping a recording for another project replaced
 * it, and the sheet removed "its" entry when it had never loaded the
 * recording (opened for another project, then Start Recording or X). The
 * first recording's audio stayed in the folder with nothing pointing at it
 * and was never offered again. Now an entry is only removed with its own
 * recording (forgetKeptVoiceRecording names the audio), and audio with no
 * entry is swept (sweepKeptVoiceRecordings).
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
  /**
   * When it was dictated, and the saved project area a Project Walk had
   * matched then (review N1 L3): a recording used after the app was closed
   * is a memory of that time and place, not of when its words arrived.
   */
  recordedAt: string;
  walkArea: KeptVoiceWalkArea | null;
}>;

/** The Project Walk's matched area, as the walk hands it to the voice sheet. */
export type KeptVoiceWalkArea = NonNullable<DAVEProjectWalkContext['recommendedArea']>;

type KeptVoiceRecordingEntry = Readonly<{
  /** The sheet that keeps it. An entry kept before review N1 M1 has none: its scope is its sheet. */
  slot?: string;
  fileName: string;
  durationMs: number;
  projectId: string | null;
  projectName: string;
  /** An entry kept before review N1 L3 has neither: its time is when it was kept, its area unknown. */
  recordedAt?: string;
  walkArea?: KeptVoiceWalkArea | null;
}>;

/** An entry as it is stored: `scope` is its key, `slot` the sheet that keeps it. */
type StoredKeptVoiceRecording = Readonly<{ scope: string; slot: string; fileName: string; recording: KeptVoiceRecording }>;

const KIND = 'voice-recording';
const KEPT_RECORDINGS_FOLDER = 'kept-recordings';
const KEPT_FILE_NAME = /^[\w.-]+\.m4a$/;

function keptFolder(): string | null {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${KEPT_RECORDINGS_FOLDER}/` : null;
}

function keptUri(fileName: string): string | null {
  const folder = keptFolder();
  return folder && KEPT_FILE_NAME.test(fileName) ? `${folder}${fileName}` : null;
}

/** Whether `uri` is a recording already kept in the documents folder. */
export function isKeptVoiceRecordingUri(uri: string | null | undefined): boolean {
  const folder = keptFolder();
  return Boolean(folder && uri && uri.startsWith(folder));
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function walkAreaOf(value: unknown): KeptVoiceWalkArea | null {
  const area = value as Partial<KeptVoiceWalkArea> | null | undefined;
  if (!area || typeof area !== 'object') return null;
  if (typeof area.id !== 'string' || typeof area.name !== 'string') return null;
  if (area.confidence !== 'high' && area.confidence !== 'medium') return null;
  if (typeof area.distanceFeet !== 'number' || !Number.isFinite(area.distanceFeet)) return null;
  return Object.freeze({ id: area.id, name: area.name, confidence: area.confidence, distanceFeet: area.distanceFeet });
}

function sameProject(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

async function fileExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return Boolean(info.exists) && (typeof (info as { size?: unknown }).size !== 'number' || (info as { size: number }).size > 0);
  } catch {
    return false;
  }
}

// A keep (the copy, then its entry) and the sweep of audio with no entry
// never overlap: the sweep never meets a copy whose entry is still to come.
let keepingOrSweeping: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = keepingOrSweeping.then(work, work);
  keepingOrSweeping = run.catch(() => undefined);
  return run;
}

/**
 * Keeps `recording` for this account and sheet: a copy of its audio in the
 * documents folder (out of the cache, which iOS may clear), and its entry.
 * The sheet keeps using the original while it is open: an upload it stopped
 * waiting for may still be reading it, and its words are held for it (A11
 * pass 4 M1). Resolves to the kept copy's address; rejects when it could not
 * be kept (the recording then stays kept in the sheet only, as before).
 * Every other kept recording stays kept (review N1 M1).
 */
export function keepVoiceRecording(
  ownerKey: string,
  slot: string,
  recording: Readonly<{
    uri: string;
    durationMs: number;
    projectId: string | null;
    projectName: string;
    recordedAt?: string;
    walkArea?: KeptVoiceWalkArea | null;
  }>,
): Promise<string> {
  return oneAtATime(async () => {
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
    const fileName = uri.slice(folder.length);
    const entry: KeptVoiceRecordingEntry = {
      slot,
      fileName,
      durationMs: Math.max(0, Math.round(recording.durationMs)),
      projectId: recording.projectId?.trim() || null,
      projectName: recording.projectName,
      recordedAt: validTime(recording.recordedAt) ? recording.recordedAt : new Date().toISOString(),
      walkArea: walkAreaOf(recording.walkArea),
    };
    // An entry kept before review N1 M1 (its scope is its sheet) is rewritten where it is.
    const scope = (await storedKeptVoiceRecordings(ownerKey)).find(stored => stored.fileName === fileName)?.scope
      ?? `${slot}/${fileName}`;
    await keepDraft(KIND, ownerKey, scope, entry);
    return uri;
  });
}

/** This account's kept recordings, oldest first; an entry whose audio is gone is removed. */
async function storedKeptVoiceRecordings(ownerKey: string): Promise<StoredKeptVoiceRecording[]> {
  const stored: StoredKeptVoiceRecording[] = [];
  for (const scope of await keptDraftScopes(KIND, ownerKey)) {
    const kept = await readKeptDraft(KIND, ownerKey, scope);
    const entry = kept?.value as Partial<KeptVoiceRecordingEntry> | undefined;
    if (!kept || !entry || typeof entry.fileName !== 'string' || typeof entry.projectName !== 'string') continue;
    const uri = keptUri(entry.fileName);
    if (!uri || !await fileExists(uri)) {
      await keepDraft(KIND, ownerKey, scope, null);
      continue;
    }
    stored.push({
      scope,
      slot: typeof entry.slot === 'string' ? entry.slot : scope,
      fileName: entry.fileName,
      recording: Object.freeze({
        uri,
        durationMs: typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs) ? entry.durationMs : 0,
        projectId: typeof entry.projectId === 'string' ? entry.projectId : null,
        projectName: entry.projectName,
        keptAt: kept.keptAt,
        recordedAt: validTime(entry.recordedAt) ? entry.recordedAt : kept.keptAt,
        walkArea: walkAreaOf(entry.walkArea),
      }),
    });
  }
  return stored.sort((left, right) => Date.parse(left.recording.recordedAt) - Date.parse(right.recording.recordedAt));
}

/**
 * The recording kept for this account and sheet (the oldest, when there are
 * several), or null. With `projectName`, only one kept for that project:
 * another project's recording stays kept for its own project (review N1 M1).
 */
export async function readKeptVoiceRecording(
  ownerKey: string,
  slot: string,
  projectName?: string,
): Promise<KeptVoiceRecording | null> {
  const kept = (await storedKeptVoiceRecordings(ownerKey)).find(stored =>
    stored.slot === slot && (projectName === undefined || sameProject(stored.recording.projectName, projectName)));
  await sweepKeptVoiceRecordings();
  return kept?.recording ?? null;
}

/**
 * THAT recording was used, discarded or recorded again: its entry and its
 * kept audio go. Named by its kept audio: nothing else is ever removed, and
 * without one nothing is (review N1 M1).
 */
export async function forgetKeptVoiceRecording(ownerKey: string, slot: string, uri?: string | null): Promise<void> {
  const folder = keptFolder();
  if (!folder || !uri || !isKeptVoiceRecordingUri(uri)) return;
  const fileName = uri.slice(folder.length);
  const scopes = (await storedKeptVoiceRecordings(ownerKey)).filter(stored => stored.fileName === fileName).map(stored => stored.scope);
  for (const scope of new Set([...scopes, `${slot}/${fileName}`])) await keepDraft(KIND, ownerKey, scope, null);
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

/** Whether this account has a recording kept on this device (the Sign Out warning names it). */
export async function keptVoiceRecordingExists(ownerKey: string): Promise<boolean> {
  return (await storedKeptVoiceRecordings(ownerKey)).length > 0;
}

/**
 * Audio in the kept folder that no entry points at is deleted (review N1 M1):
 * a copy whose entry was never written (the app closed between the two), or
 * left by an entry removed without it. Nothing is deleted unless every entry
 * on this phone, for every account, could be listed and read; a keep under
 * way is waited for first (oneAtATime).
 */
export function sweepKeptVoiceRecordings(): Promise<void> {
  return oneAtATime(async () => {
    const folder = keptFolder();
    if (!folder) return;
    let files: string[];
    try {
      files = await FileSystem.readDirectoryAsync(folder);
    } catch {
      return; // No folder: nothing was ever kept.
    }
    const audio = files.filter(file => KEPT_FILE_NAME.test(file));
    if (audio.length === 0) return;
    const entries = await keptDraftsOnDevice(KIND);
    if (!entries) return;
    const pointedAt = new Set<string>();
    for (const { ownerKey, scope } of entries) {
      const fileName = ((await readKeptDraft(KIND, ownerKey, scope))?.value as Partial<KeptVoiceRecordingEntry> | undefined)?.fileName;
      // An entry that cannot be read may point at any of them: nothing is swept this time.
      if (typeof fileName !== 'string') return;
      pointedAt.add(fileName);
    }
    for (const file of audio) {
      if (!pointedAt.has(file)) await FileSystem.deleteAsync(`${folder}${file}`, { idempotent: true }).catch(() => undefined);
    }
  }).catch(() => undefined);
}

/** Account change or sign-out, as for the other unsaved drafts: every kept recording goes. */
export function forgetKeptVoiceRecordings(): void {
  void forgetKeptDrafts(KIND);
  const folder = keptFolder();
  if (folder) void FileSystem.deleteAsync(folder, { idempotent: true }).catch(() => undefined);
}
