/**
 * Sync batch Y3, item 1 (6 Oct 2026). Open item: "Photos with nothing in the
 * cloud are still looked up on every refresh, live update and Settings
 * download. An update card whose first photo is one of these shows a blank
 * thumbnail."
 *
 * Runs the real preview signing (cache, dedupe, limit), the real live-update
 * applier, the launch download (loadCloudUpdates), the photo upload, the
 * image hook, and the card's own thumbnail lines compiled from App.tsx. Only
 * the cloud calls are stand-ins; `lookUps` counts every request made about a
 * photo's storage path.
 */
import React from 'react';
import { Image } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []),
    multiGet: jest.fn(async () => []), multiSet: jest.fn(async () => undefined),
  },
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));
const mockFilesHere = new Set<string>();
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/NEW/Documents/',
  cacheDirectory: 'file:///var/mobile/Containers/Data/Application/NEW/Library/Caches/',
  getInfoAsync: jest.fn(async (uri: string) => (mockFilesHere.has(uri)
    ? { exists: true, isDirectory: false, size: 1234, modificationTime: 1 }
    : { exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  downloadAsync: jest.fn(async (_url: string, destination: string) => ({ uri: destination })),
  readAsStringAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));
jest.mock('../../services/SupabaseService', () => ({
  ...jest.requireActual('../../services/SupabaseService'),
  createPhotoSignedUrl: jest.fn(),
  listProjectUpdates: jest.fn(),
  uploadPhoto: jest.fn(),
  verifyDAVEAppOwner: jest.fn(),
  subscribeToAuthStateChange: jest.fn(() => () => undefined),
}));
jest.mock('../../services/SyncService', () => ({
  ...jest.requireActual('../../services/SyncService'),
  requestPendingChangesUpload: jest.fn(),
}));

import {
  createPhotoSignedUrl, listProjectUpdates, uploadPhoto, verifyDAVEAppOwner,
} from '../../services/SupabaseService';
import {
  hydrateProjectUpdatePhotoPreviews, hydrateRecoveredProjectUpdatePhotos, signProjectPhotoPreview,
  uploadLocalPhotoWithDiagnostics,
} from '../../services/SyncService';
import { loadCloudUpdates } from '../../services/updateService';
import { createDAVEOperationalRealtimeApplier } from '../../services/DAVEOperationalRealtimeApplication';
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import * as PhotoTransport from '../../services/ProjectPhotoTransport';
import { useProjectPhotoDisplayUri } from '../../hooks/use-project-photo-display-uri';
import type { ProjectUpdate, UpdatePhoto } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const nodePath = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const source = (file: string) => fs.readFileSync(nodePath.resolve(__dirname, '../..', file), 'utf8');

const signedUrl = createPhotoSignedUrl as jest.Mock;
const listUpdates = listProjectUpdates as jest.Mock;
const upload = uploadPhoto as jest.Mock;
const ownerCheck = verifyDAVEAppOwner as jest.Mock;

const HERE = 'file:///var/mobile/Containers/Data/Application/NEW/Documents/project-photos/';
const OTHER_DEVICE = 'file:///var/mobile/Containers/Data/Application/IPAD/Documents/project-photos/';
const SIGNED = /^https:\/\/signed\.example\//;
/** Storage paths with nothing behind them: the cloud answers "not found". */
const notInCloud = new Set<string>();
let noSignal = false;
let lookUps: string[] = [];
const lookUpsOf = (photo: UpdatePhoto) => lookUps.filter(path => path === photo.cloudStoragePath).length;
/** What this account has been told is not in the cloud (nothing was remembered before this fix). */
const knownNotInCloud = (storagePath: string | null | undefined): boolean => Boolean(
  (PhotoTransport as unknown as { photoKnownNotInCloud?: (path: string | null | undefined) => boolean })
    .photoKnownNotInCloud?.(storagePath));

let serial = 0;
/** Each test has its own update and paths: the signing cache lives as long as the module. */
function nextUpdateId() { serial += 1; return `u${serial}`; }
const photoOf = (updateId: string, id: string, extra: Partial<UpdatePhoto> = {}): UpdatePhoto => ({
  id, uri: `${OTHER_DEVICE}${id}.jpg`, caption: '', category: 'Update', actionRequired: '', actionOwner: '',
  actionDueDate: '', actionStatus: 'Open', fileName: `IMG_${id}.jpg`, mimeType: 'image/jpeg',
  cloudStoragePath: `canopy-b/${updateId}/${id}-IMG_${id}.jpg`, ...extra,
} as UpdatePhoto);
/** Nothing behind its path, and nothing on the record says so. */
function nothingInCloud(updateId: string, id: string, extra: Partial<UpdatePhoto> = {}): UpdatePhoto {
  const photo = photoOf(updateId, id, extra);
  notInCloud.add(photo.cloudStoragePath!);
  return photo;
}
/** Nothing behind its path, and the sync marked it so when it found no file to upload. */
const markedUnavailable = (updateId: string, id: string) =>
  nothingInCloud(updateId, id, { uri: '', cloudRecoveryStatus: 'unavailable' });
const fieldUpdate = (id: string, photos: UpdatePhoto[]) => ({
  id, projectName: 'Canopy B', date: '2026-10-01', notes: 'Panels set', recipients: { contactIds: [] },
  status: 'sent', photos,
} as unknown as ProjectUpdate);

beforeEach(() => {
  jest.useRealTimers();
  notInCloud.clear();
  mockFilesHere.clear();
  noSignal = false;
  lookUps = [];
  noteSignedInOwner(null);
  noteSignedInOwner('owner-david');
  signedUrl.mockReset().mockImplementation(async (storagePath: string) => {
    lookUps.push(storagePath);
    if (noSignal) return { ok: false, stubbed: false, data: null, error: 'Network request failed' };
    return notInCloud.has(storagePath)
      ? { ok: false, stubbed: false, data: null, error: 'Object not found', status: 400 }
      : { ok: true, stubbed: false, data: `https://signed.example/${storagePath}?preview` };
  });
  ownerCheck.mockReset().mockImplementation(async () => ({ ok: true, stubbed: false, data: true }));
  upload.mockReset().mockImplementation(async ({ path }: { path: string }) => {
    notInCloud.delete(path);
    return { ok: true, stubbed: false, data: { bucket: 'project-photos', path, fullPath: null } };
  });
  listUpdates.mockReset();
});

/** A live update of this field update arriving from the other device, through the real applier. */
async function liveUpdate(update: ProjectUpdate, saved: ProjectUpdate[] = []): Promise<ProjectUpdate> {
  const commitUpdates = jest.fn();
  const state = { projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [], updates: saved,
    deletedUpdates: [], tombstones: [], areas: [], scheduleItems: [], documents: [] };
  const apply = createDAVEOperationalRealtimeApplier({
    isActive: () => true, snapshot: () => state as never, getPendingQueue: async () => [],
    normalizeUpdate: (value: unknown) => value as never, normalizeAreas: () => [], normalizeSchedule: () => [],
    normalizeDocuments: () => [], migrateSchedule: item => item,
    localPhotoUri: (photo: Partial<UpdatePhoto>) => (photo.uri?.startsWith(HERE) ? photo.uri : ''),
    mergeProjectNames: (names: string[]) => names, updateHasPendingLocalWork: () => false,
    mergeUpdates: ((input: { cloudUpdates: unknown[] }) => input.cloudUpdates) as never,
    buildUpdateTombstone: (() => ({})) as never, buildCloudDeletionBarrier: (() => ({})) as never,
    upsertDeletedUpdate: ((current: unknown[]) => current) as never,
    commitProjects: jest.fn(), commitDeletedProjects: jest.fn(), commitUpdates, commitDeletedUpdates: jest.fn(),
    commitTombstones: jest.fn(), commitAreas: jest.fn(), commitSchedule: jest.fn(), commitDocuments: jest.fn(),
  });
  await apply('project_update', { eventType: 'UPDATE', newRow: { id: update.id, update_data: update }, oldRow: null, raw: null });
  return (commitUpdates.mock.calls[0]?.[0] as ProjectUpdate[] | undefined)?.find(item => item.id === update.id) ?? update;
}
/** What Settings' download does with each cloud row (pinned below to the source). */
const settingsDownload = (update: ProjectUpdate) => hydrateProjectUpdatePhotoPreviews(update);
/** The download a launch makes of every field update. */
async function launchDownload(update: ProjectUpdate): Promise<ProjectUpdate> {
  listUpdates.mockResolvedValue({ ok: true, stubbed: false, data: [{ id: update.id, updateData: update }] });
  return (await loadCloudUpdates<ProjectUpdate>())[0];
}

describe('the three places that looked a photo up are the ones exercised here', () => {
  it('Settings download, the launch download and the live update all go through the one preview function', () => {
    expect(source('services/SyncService.ts')).toContain(
      'download.updates.map(row => hydrateProjectUpdatePhotoPreviews(row.updateData))');
    expect(source('services/updateService.ts')).toContain('await hydrateProjectUpdatePhotoPreviews(update)');
    expect(source('services/DAVEOperationalRealtimeApplication.ts')).toContain(
      'hydrateProjectUpdatePhotoPreviews({ ...cloudUpdate, photos })');
    // The timed refresh signs nothing at all (A4 pass 6; tests in audit-a7-m3-photo-transport).
    expect(source('App.tsx')).toMatch(/preserveLocalPhotoTransport\(cloudPhoto, localUpdate, resolveProjectPhotoUri\)\),\n\s+\}, \{ sign: false \}\);/);
  });
});

describe("a photo the sync marked 'unavailable' (nothing was uploaded for it)", () => {
  it('is not looked up by a live update, a Settings download or the launch download; the photo beside it still is', async () => {
    const id = nextUpdateId();
    const gone = markedUnavailable(id, 'p1');
    const there = photoOf(id, 'p2');
    const update = fieldUpdate(id, [gone, there]);

    const live = await liveUpdate(update);
    const downloaded = await settingsDownload(update);
    const launched = await launchDownload(update);

    expect(lookUpsOf(gone)).toBe(0);
    expect(lookUpsOf(there)).toBe(1); // signed once, then from the signing cache
    for (const copy of [live, downloaded, launched]) {
      expect(copy.photos[0].cloudRecoveryStatus).toBe('unavailable');
      expect(copy.photos[0].cloudPreviewUri ?? '').toBe('');
      expect(copy.photos[0].cloudStoragePath).toBe(gone.cloudStoragePath); // the record keeps its path
      expect(copy.photos[1].cloudPreviewUri).toMatch(SIGNED);
    }
  });
});

describe('a photo with nothing in the cloud and no mark on the record', () => {
  it('is looked up once and then remembered: three live updates, two Settings downloads and a launch download ask once', async () => {
    const id = nextUpdateId();
    const gone = nothingInCloud(id, 'p1');
    const there = photoOf(id, 'p2');
    const update = fieldUpdate(id, [gone, there]);

    await liveUpdate(update);
    await liveUpdate(update);
    await liveUpdate(update);
    await settingsDownload(update);
    await settingsDownload(update);
    const launched = await launchDownload(update);

    expect(lookUpsOf(gone)).toBe(1);
    expect(ownerCheck).toHaveBeenCalledTimes(1); // the one question that makes "not found" an answer
    expect(launched.photos[0].cloudStoragePath).toBe(gone.cloudStoragePath);
    expect(launched.photos[1].cloudPreviewUri).toMatch(SIGNED);
    expect(knownNotInCloud(gone.cloudStoragePath)).toBe(true);
    expect(PhotoTransport.signableCloudPhotoPath(gone)).toBe('');
    expect(PhotoTransport.signableCloudPhotoPath(there)).toBe(there.cloudStoragePath);
  });

  it('no signal is not an answer: nothing is remembered, and the photo is found when the signal is back', async () => {
    const id = nextUpdateId();
    const farAway = photoOf(id, 'p1');
    const update = fieldUpdate(id, [farAway]);
    noSignal = true;

    await liveUpdate(update);
    await settingsDownload(update);
    expect(lookUpsOf(farAway)).toBe(2);
    expect(ownerCheck).not.toHaveBeenCalled();
    expect(knownNotInCloud(farAway.cloudStoragePath)).toBe(false);

    noSignal = false;
    expect((await settingsDownload(update)).photos[0].cloudPreviewUri).toMatch(SIGNED);
  });

  it('"not found" is not remembered when the cloud does not confirm the owner is asking: a lapsed sign-in is told that of every photo', async () => {
    const id = nextUpdateId();
    const hidden = nothingInCloud(id, 'p1');
    const update = fieldUpdate(id, [hidden]);

    ownerCheck.mockImplementation(async () => ({ ok: true, stubbed: false, data: false }));
    await settingsDownload(update);
    ownerCheck.mockImplementation(async () => ({ ok: false, stubbed: false, error: 'Network request failed' }));
    await settingsDownload(update);
    ownerCheck.mockImplementation(async () => { throw new Error('offline'); });
    await settingsDownload(update);
    expect(knownNotInCloud(hidden.cloudStoragePath)).toBe(false);
    expect(lookUpsOf(hidden)).toBe(3);

    // Signed in again, the photo is there after all.
    notInCloud.delete(hidden.cloudStoragePath!);
    expect((await settingsDownload(update)).photos[0].cloudPreviewUri).toMatch(SIGNED);
  });

  it('a bucket or permission error is not "this photo is not in the cloud"', async () => {
    const id = nextUpdateId();
    const photo = photoOf(id, 'p1');
    signedUrl.mockImplementation(async (storagePath: string) => {
      lookUps.push(storagePath);
      return { ok: false, stubbed: false, data: null, error: 'Bucket not found', status: 404 };
    });
    await settingsDownload(fieldUpdate(id, [photo]));
    await settingsDownload(fieldUpdate(id, [photo]));
    expect(lookUpsOf(photo)).toBe(2);
    expect(knownNotInCloud(photo.cloudStoragePath)).toBe(false);
  });

  it('is forgotten when this device uploads the photo: the next download signs it and shows it', async () => {
    const id = nextUpdateId();
    const mine = nothingInCloud(id, 'p1', { uri: `${HERE}mine.jpg` });
    const update = fieldUpdate(id, [mine]);
    // The other device's row for it, before this phone's file has gone up.
    const asListed = fieldUpdate(id, [{ ...mine, uri: `${OTHER_DEVICE}as-the-ipad-names-it.jpg` }]);
    await settingsDownload(asListed);
    await settingsDownload(asListed);
    expect(lookUpsOf(mine)).toBe(1);
    expect(knownNotInCloud(mine.cloudStoragePath)).toBe(true);

    mockFilesHere.add(mine.uri);
    const sent = await uploadLocalPhotoWithDiagnostics(update, mine);
    expect(sent.result).toBe('uploaded');
    expect(knownNotInCloud(mine.cloudStoragePath)).toBe(false);

    lookUps = [];
    const after = await settingsDownload(asListed);
    expect(lookUpsOf(mine)).toBe(1);
    expect(after.photos[0].cloudPreviewUri).toMatch(SIGNED);
  });

  it('is forgotten when the upload finds another device has put it in the cloud meanwhile', async () => {
    const id = nextUpdateId();
    const theirs = nothingInCloud(id, 'p1');
    const update = fieldUpdate(id, [theirs]);
    await settingsDownload(update);
    expect(knownNotInCloud(theirs.cloudStoragePath)).toBe(true);

    notInCloud.delete(theirs.cloudStoragePath!); // the iPad's upload lands
    expect((await uploadLocalPhotoWithDiagnostics(update, theirs)).result).toBe('skipped');
    expect(knownNotInCloud(theirs.cloudStoragePath)).toBe(false);
    expect((await settingsDownload(update)).photos[0].cloudPreviewUri).toMatch(SIGNED);
  });

  it('a report or a backup still looks every time, and forgets it when the photo is there after all', async () => {
    const id = nextUpdateId();
    const late = nothingInCloud(id, 'p1');
    const update = fieldUpdate(id, [late]);
    await settingsDownload(update);
    expect(knownNotInCloud(late.cloudStoragePath)).toBe(true);

    // Still nothing there: the report's own look-up asks all the same, and it stays remembered.
    lookUps = [];
    await hydrateRecoveredProjectUpdatePhotos(update);
    expect(lookUpsOf(late)).toBe(1);
    expect(knownNotInCloud(late.cloudStoragePath)).toBe(true);

    notInCloud.delete(late.cloudStoragePath!); // the iPad's upload lands
    const forReport = await hydrateRecoveredProjectUpdatePhotos(update);
    expect(forReport.photos[0].uri).toBeTruthy();
    expect(knownNotInCloud(late.cloudStoragePath)).toBe(false);
    expect((await settingsDownload(update)).photos[0].cloudPreviewUri).toMatch(SIGNED);
  });

  it('is kept per account: forgotten when the account changes, not handed to the next account, and not back when the first signs in again', async () => {
    const id = nextUpdateId();
    const gone = nothingInCloud(id, 'p1');
    const update = fieldUpdate(id, [gone]);
    await settingsDownload(update);
    await settingsDownload(update);
    expect(lookUpsOf(gone)).toBe(1);

    noteSignedInOwner('owner-other');
    expect(knownNotInCloud(gone.cloudStoragePath)).toBe(false);
    notInCloud.delete(gone.cloudStoragePath!); // this account can see a photo at that path
    expect((await settingsDownload(update)).photos[0].cloudPreviewUri).toMatch(SIGNED);
    expect(lookUpsOf(gone)).toBe(2);

    noteSignedInOwner('owner-david');
    expect(knownNotInCloud(gone.cloudStoragePath)).toBe(false);
  });

  it('an answer that arrives after the account changed is not kept for either account', async () => {
    const id = nextUpdateId();
    const gone = nothingInCloud(id, 'p1');
    ownerCheck.mockImplementation(async () => {
      noteSignedInOwner('owner-other'); // the sign-in changes while the look-up is still out
      return { ok: true, stubbed: false, data: true };
    });
    await settingsDownload(fieldUpdate(id, [gone]));
    expect(knownNotInCloud(gone.cloudStoragePath)).toBe(false);
    noteSignedInOwner('owner-david');
    expect(knownNotInCloud(gone.cloudStoragePath)).toBe(false);
  });

  it('nothing is remembered while signed out, and the list is bounded: the oldest answers go first', async () => {
    const id = nextUpdateId();
    noteSignedInOwner(null);
    const gone = nothingInCloud(id, 'p1');
    await settingsDownload(fieldUpdate(id, [gone]));
    expect(knownNotInCloud(gone.cloudStoragePath)).toBe(false);

    noteSignedInOwner('owner-david');
    const { currentCloudOwner } = jest.requireActual('../../services/CloudOwnerBinding') as typeof import('../../services/CloudOwnerBinding');
    for (let index = 0; index <= 2000; index += 1) {
      PhotoTransport.rememberPhotoNotInCloud(`bound/${id}/${index}.jpg`, currentCloudOwner());
    }
    expect(knownNotInCloud(`bound/${id}/0.jpg`)).toBe(false);
    expect(knownNotInCloud(`bound/${id}/1.jpg`)).toBe(true);
    expect(knownNotInCloud(`bound/${id}/2000.jpg`)).toBe(true);
  });
});

describe('the image of a photo with nothing in the cloud', () => {
  function Shown({ photo }: { photo: UpdatePhoto }) {
    const shown = useProjectPhotoDisplayUri(photo, '');
    return <Image testID="photo" source={{ uri: shown.uri }} onError={shown.onError} />;
  }
  /** An hour of the screen left open, in steps short enough for each retry to be drawn before the next is due. */
  async function throughAnHour() {
    for (let passed = 0; passed < 60 * 60_000; passed += 5_000) {
      await act(async () => { await jest.advanceTimersByTimeAsync(5_000); });
    }
  }

  it('asks once and not again in the next hour, where it asked about 16 times; a photo that is only out of signal keeps trying', async () => {
    jest.useFakeTimers();
    try {
      const id = nextUpdateId();
      const gone = nothingInCloud(id, 'p1', { uri: '' });
      const view = render(<Shown photo={gone} />);
      await throughAnHour();
      expect(lookUpsOf(gone)).toBe(1);
      expect(screen.getByTestId('photo').props.source.uri).toBe('');
      view.unmount();

      const farAway = photoOf(id, 'p2', { uri: '' });
      noSignal = true;
      const second = render(<Shown photo={farAway} />);
      await throughAnHour();
      expect(lookUpsOf(farAway)).toBe(16);
      second.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('signing it directly asks nothing more either, even when the image asks for a fresh address', async () => {
    const id = nextUpdateId();
    const gone = nothingInCloud(id, 'p1');
    expect(await signProjectPhotoPreview(gone)).toBeNull();
    expect(await signProjectPhotoPreview(gone)).toBeNull();
    expect(await signProjectPhotoPreview(gone, { force: true })).toBeNull();
    expect(lookUpsOf(gone)).toBe(1);
  });
});

describe("an update card's thumbnail (the card's own lines, compiled from App.tsx)", () => {
  const app = source('App.tsx');
  const cardStart = app.indexOf('\nfunction UpdateHistoryCard(');
  const cardLines = app.slice(cardStart, app.indexOf('\n  return (', cardStart)).split('\n')
    .filter(line => /^  const thumbnail\w* = /.test(line));
  const compiled = ts.transpileModule(
    `module.exports = function useCardThumbnail(update) {\n${cardLines.join('\n')}\n  return thumbnail;\n};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const cardModule = { exports: {} as unknown as (update: ProjectUpdate) => { uri: string; onError: () => void } };
  const resolveProjectPhotoUri = (photo: Partial<UpdatePhoto>) => (photo.uri?.startsWith(HERE) ? photo.uri : '');
  const injected: Record<string, unknown> = {
    useProjectPhotoDisplayUri, resolveProjectPhotoUri,
    // Absent before this fix: the card had no such function to call.
    firstProjectPhotoToShow: (PhotoTransport as Record<string, unknown>).firstProjectPhotoToShow,
  };
  new Function('module', 'exports', ...Object.keys(injected), compiled)(cardModule, cardModule.exports, ...Object.values(injected));
  const useCardThumbnail = cardModule.exports;
  function Card({ update }: { update: ProjectUpdate }) {
    const thumbnail = useCardThumbnail(update);
    return thumbnail.uri
      ? <Image testID="thumbnail" source={{ uri: thumbnail.uri }} onError={thumbnail.onError} />
      : <Image testID="placeholder" source={{ uri: '' }} />;
  }
  const settle = () => act(async () => { for (let turn = 0; turn < 12; turn += 1) await Promise.resolve(); });

  it('reads the card as App.tsx has it', () => {
    expect(cardLines.length).toBeGreaterThan(0);
    expect(cardLines.join('\n')).toContain('useProjectPhotoDisplayUri(');
  });

  it("first photo marked 'unavailable', second in the cloud: the card shows the second, and the first is never looked up", async () => {
    const id = nextUpdateId();
    const gone = markedUnavailable(id, 'p1');
    const there = photoOf(id, 'p2', { uri: '' });
    render(<Card update={fieldUpdate(id, [gone, there])} />);
    await settle();
    expect(screen.getByTestId('thumbnail').props.source.uri).toBe(`https://signed.example/${there.cloudStoragePath}?preview`);
    expect(lookUpsOf(gone)).toBe(0);
  });

  it('first photo has nothing in the cloud and no mark: after the one look-up the card shows the second photo, with no wait', async () => {
    const id = nextUpdateId();
    const gone = nothingInCloud(id, 'p1', { uri: '' });
    const there = photoOf(id, 'p2', { uri: '' });
    render(<Card update={fieldUpdate(id, [gone, there])} />);
    await settle();
    expect(screen.getByTestId('thumbnail').props.source.uri).toBe(`https://signed.example/${there.cloudStoragePath}?preview`);
    expect(lookUpsOf(gone)).toBe(1);
  });

  it("first photo marked 'unavailable', second is this device's own file: the card shows the file", async () => {
    const id = nextUpdateId();
    const gone = markedUnavailable(id, 'p1');
    const mine = photoOf(id, 'p2', { uri: `${HERE}mine.jpg`, cloudStoragePath: undefined });
    render(<Card update={fieldUpdate(id, [gone, mine])} />);
    await settle();
    expect(screen.getByTestId('thumbnail').props.source.uri).toBe(`${HERE}mine.jpg`);
    expect(lookUps).toEqual([]);
  });

  it('as before: a first photo that can be shown is the thumbnail, its own file ahead of anything signed', async () => {
    const id = nextUpdateId();
    const mine = photoOf(id, 'p1', { uri: `${HERE}first.jpg` });
    const there = photoOf(id, 'p2', { uri: '' });
    const view = render(<Card update={fieldUpdate(id, [mine, there])} />);
    await settle();
    expect(screen.getByTestId('thumbnail').props.source.uri).toBe(`${HERE}first.jpg`);
    view.unmount();

    const cloudFirst = photoOf(id, 'p3', { uri: '' });
    render(<Card update={fieldUpdate(id, [cloudFirst, there])} />);
    await settle();
    expect(screen.getByTestId('thumbnail').props.source.uri).toBe(`https://signed.example/${cloudFirst.cloudStoragePath}?preview`);
  });

  it('as before: a first photo that is only out of signal keeps its place; the card does not jump to another photo', async () => {
    const id = nextUpdateId();
    const farAway = photoOf(id, 'p1', { uri: '' });
    const mine = photoOf(id, 'p2', { uri: `${HERE}second.jpg` });
    noSignal = true;
    const view = render(<Card update={fieldUpdate(id, [farAway, mine])} />);
    await settle();
    expect(screen.queryByTestId('thumbnail')).toBeNull();
    expect(lookUpsOf(farAway)).toBe(1);
    expect(knownNotInCloud(farAway.cloudStoragePath)).toBe(false);
    view.unmount(); // its retry timer goes with it
  });

  it('no photo of the update can be shown: the placeholder, and each photo is asked about once at most', async () => {
    const id = nextUpdateId();
    const gone = markedUnavailable(id, 'p1');
    const alsoGone = nothingInCloud(id, 'p2', { uri: '' });
    const view = render(<Card update={fieldUpdate(id, [gone, alsoGone])} />);
    await settle();
    expect(screen.getByTestId('placeholder')).toBeTruthy();
    expect(lookUpsOf(gone) + lookUpsOf(alsoGone)).toBe(1);
    view.rerender(<Card update={fieldUpdate(id, [gone, alsoGone])} />);
    await settle();
    expect(lookUpsOf(gone) + lookUpsOf(alsoGone)).toBe(1);
    expect(fieldUpdate(id, []).photos).toEqual([]);
    view.rerender(<Card update={fieldUpdate(id, [])} />); // an update with no photo at all
    await settle();
    expect(screen.getByTestId('placeholder')).toBeTruthy();
  });
});
