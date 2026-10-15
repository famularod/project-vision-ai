/**
 * Open item 5.26 (found by David on his iPhone, Build 232 check 6, 14 Oct 2026; the Build 233 round). Adding a PDF in
 * a project's Documents as Other (with or without signal) showed "Document unavailable - The manifest-owned file is
 * missing from local storage." and no card was made.
 *
 * Cause (older: since Expo SDK 56 the app's file library copies in the background). expo-file-system's File.copy()
 * now returns a promise (its 56.0.0 change: "copy() and move() ... are now asynchronous"; copySync() is the old one).
 * The app's own copy into its document storage (services/ExpoOwnedLocalFileStoreAdapter.ts) did not wait for it, so
 * the check straight after the copy looked for the copy before it was there, called it missing, and refused the add.
 * Every document added on the phone or iPad goes through it: Documents (Other, Drawing, a Schedule kept as a card),
 * a field update's attachment, a document photo, Replace File, a backup restore.
 *
 * The road: the app's real importProjectDocumentIntoOwnedStorage with its real Expo adapter, OwnedLocalFileStore and
 * FileSizePreflight; only the file library is a made-up one whose copy lands a moment later, as the native copy does.
 */
const mockDisk = new Map<string, Uint8Array>();
const mockCopy = { fails: false };

jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists() { return mockDisk.has(this.uri); }
    get size() { return mockDisk.get(this.uri)?.byteLength ?? 0; }
    /** As expo-file-system 56+: the copy is made off the JS thread and the promise settles once it is there. */
    copy(destination: { uri: string }) {
      const bytes = mockDisk.get(this.uri);
      return new Promise<void>((resolve, reject) => setTimeout(() => {
        if (mockCopy.fails || !bytes) return reject(new Error('The native copy failed.'));
        mockDisk.set(destination.uri, bytes.slice());
        resolve();
      }, 0));
    }
    async bytes() { return (mockDisk.get(this.uri) as Uint8Array).slice(); }
    delete() { mockDisk.delete(this.uri); }
    open() {
      const bytes = mockDisk.get(this.uri) as Uint8Array;
      let at = 0;
      return {
        size: bytes.byteLength,
        readBytes(length: number) { const chunk = bytes.slice(at, at + length); at += chunk.byteLength; return chunk; },
        close() { /* nothing held */ },
      };
    }
  }
  class Directory {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists() { return true; }
    create() { /* the folder is there */ }
  }
  return { File, Directory };
});
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: async (uri: string) => mockDisk.has(uri)
    ? { exists: true, size: (mockDisk.get(uri) as Uint8Array).byteLength }
    : { exists: false },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '5e26a0b1-4c2d-4e8f-9a1b-2c3d4e5f6a7b' }));

import { importProjectDocumentIntoOwnedStorage } from '../../services/ProjectDocumentLifecycle';

const OWNED_ROOT = 'file:///app/Documents/project-documents-v2/';
const PICKED = 'file:///app/Library/Caches/DocumentPicker/0F1E2D3C.pdf';
/** A made-up one-page PDF's bytes. */
const F2 = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% made-up test sheet F2\n%%EOF\n');

beforeEach(() => {
  mockDisk.clear();
  mockCopy.fails = false;
  mockDisk.set(PICKED, F2.slice());
});

const addAsOther = () => importProjectDocumentIntoOwnedStorage({
  sourceUri: PICKED,
  ownedRoot: OWNED_ROOT,
  fileName: 'F2.pdf',
  mimeType: 'application/pdf',
  reportedSizeBytes: F2.byteLength,
});

describe('Open item 5.26: a document added on the phone is copied into app storage before it is checked', () => {
  it('the add waits for the copy: the PDF is in app storage with its size and fingerprint, and nothing is called missing', async () => {
    const owned = await addAsOther();

    expect(owned.localUri).toBe(`${OWNED_ROOT}5e26a0b1-4c2d-4e8f-9a1b-2c3d4e5f6a7b.pdf`);
    expect(mockDisk.get(owned.localUri)).toEqual(F2);
    expect(owned.record.sizeBytes).toBe(F2.byteLength);
    expect(owned.record.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('a copy that fails is said as a failed copy (the app can retry it), never as a file gone missing', async () => {
    mockCopy.fails = true;

    await expect(addAsOther()).rejects.toThrow('The selected file could not be copied into app-owned storage.');
    expect([...mockDisk.keys()]).toEqual([PICKED]);
  });
});
