import {
  OWNED_LOCAL_FILE_MANIFEST_VERSION,
  createOwnedLocalFileManifest,
  createOwnedLocalFileManifestRecord,
  generateOwnedLocalFileBasename,
  isOwnedLocalFileManifestMember,
  isOwnedLocalFileReadDeleteAuthorized,
  isValidOwnedLocalFileManifest,
  parseOwnedLocalFileManifest,
  resolveOwnedLocalFilePath,
  type OwnedLocalFileManifestRecord,
  type OwnedLocalFileManifestRecordInput,
} from '../../services/OwnedLocalFileRepository';

const FILE_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_FILE_ID = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const SHA256 = 'a'.repeat(64);
const BASENAME = `${FILE_ID}.jpg`;
const OWNED_ROOT = 'file:///var/mobile/Containers/Data/Application/app/Documents/owned';

const RECORD_INPUT: OwnedLocalFileManifestRecordInput = {
  fileId: FILE_ID,
  kind: 'photo',
  generatedBasename: BASENAME,
  sha256: SHA256,
  sizeBytes: 12_345,
  mimeType: 'image/jpeg',
  relativePath: BASENAME,
};

function createRecord(
  overrides: Partial<OwnedLocalFileManifestRecordInput> = {},
): OwnedLocalFileManifestRecord {
  return createOwnedLocalFileManifestRecord({
    ...RECORD_INPUT,
    ...overrides,
  });
}

describe('OwnedLocalFileRepository', () => {
  describe('generated record identity', () => {
    it('generates a safe basename from an opaque file ID and extension', () => {
      expect(generateOwnedLocalFileBasename(FILE_ID, 'jpg')).toBe(BASENAME);
      expect(generateOwnedLocalFileBasename('opaque_file_id_123456', 'pdf'))
        .toBe('opaque_file_id_123456.pdf');
    });

    it.each(['', '.jpg', 'JPEG', 'tar.gz', 'jpg/', 'jpg%2f', '12345678901'])(
      'rejects unsafe extension %p',
      extension => {
        expect(() => generateOwnedLocalFileBasename(FILE_ID, extension))
          .toThrow('Owned local file extension');
      },
    );

    it('creates a canonical immutable record', () => {
      const record = createRecord();

      expect(record).toEqual({
        version: OWNED_LOCAL_FILE_MANIFEST_VERSION,
        ...RECORD_INPUT,
      });
      expect(Object.isFrozen(record)).toBe(true);
    });

    it.each([
      '../malicious.jpg',
      '%2e%2e%2fmalicious.jpg',
      '%252e%252e%252fmalicious.jpg',
      '/tmp/malicious.jpg',
      'file:///tmp/malicious.jpg',
      'content://provider/malicious.jpg',
      'folder/malicious.jpg',
      'folder\\malicious.jpg',
      'https:malicious.jpg',
    ])('rejects unsafe relative path %p', relativePath => {
      expect(() => createRecord({ relativePath }))
        .toThrow(/relative path|path-safe filename/);
    });

    it.each([
      '../malicious.jpg',
      '%2e%2e%2fmalicious.jpg',
      '%252e%252e%252fmalicious.jpg',
      '/tmp/malicious.jpg',
      'file:///tmp/malicious.jpg',
      'folder/malicious.jpg',
      'folder\\malicious.jpg',
    ])('rejects unsafe generated basename %p', generatedBasename => {
      expect(() => createRecord({ generatedBasename, relativePath: generatedBasename }))
        .toThrow(/generated basename|path-safe filename/);
    });

    it('rejects a basename that was not generated from the file ID', () => {
      expect(() => createRecord({
        generatedBasename: `${OTHER_FILE_ID}.jpg`,
        relativePath: `${OTHER_FILE_ID}.jpg`,
      })).toThrow('generated basename must be the file ID');
    });

    it('rejects a relative path that differs from the generated basename', () => {
      expect(() => createRecord({ relativePath: `${FILE_ID}.png` }))
        .toThrow('relative path must exactly equal');
    });

    it.each([
      '',
      'a'.repeat(63),
      'g'.repeat(64),
      'A'.repeat(64),
      `${'a'.repeat(64)}00`,
    ])('rejects malformed SHA-256 %p', sha256 => {
      expect(() => createRecord({ sha256 }))
        .toThrow('SHA-256 must be 64 lowercase hexadecimal characters');
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
      'rejects malformed size %p',
      sizeBytes => {
        expect(() => createRecord({ sizeBytes }))
          .toThrow('size must be a positive safe integer');
      },
    );

    it.each([
      '',
      'image',
      'Image/JPEG',
      'image/jpeg; charset=utf-8',
      'image /jpeg',
      'image\\jpeg',
    ])('rejects malformed MIME type %p', mimeType => {
      expect(() => createRecord({ mimeType }))
        .toThrow('MIME type must be a canonical lowercase media type');
    });

    it('rejects an invalid kind at runtime', () => {
      expect(() => createOwnedLocalFileManifestRecord({
        ...RECORD_INPUT,
        kind: 'arbitrary' as 'photo',
      })).toThrow('kind is invalid');
    });
  });

  describe('strict manifest validation', () => {
    it('creates an immutable manifest keyed by exact file ID', () => {
      const record = createRecord();
      const manifest = createOwnedLocalFileManifest([record]);

      expect(manifest).toEqual({
        version: OWNED_LOCAL_FILE_MANIFEST_VERSION,
        files: { [FILE_ID]: record },
      });
      expect(Object.isFrozen(manifest)).toBe(true);
      expect(Object.isFrozen(manifest.files)).toBe(true);
      expect(Object.isFrozen(manifest.files[FILE_ID])).toBe(true);
      expect(isValidOwnedLocalFileManifest(manifest)).toBe(true);
    });

    it('rejects duplicate file IDs', () => {
      expect(() => createOwnedLocalFileManifest([createRecord(), createRecord()]))
        .toThrow(`Duplicate owned local file ID: ${FILE_ID}`);
    });

    it.each([
      null,
      [],
      { version: 2, files: {} },
      { version: 1, files: null },
      { version: 1, files: [] },
      { version: 1, files: {}, unexpected: true },
      { version: 1 },
    ])('rejects corrupted manifest value %#', value => {
      expect(() => parseOwnedLocalFileManifest(value)).toThrow();
      expect(isValidOwnedLocalFileManifest(value)).toBe(false);
    });

    it('rejects a manifest key that differs from its record file ID', () => {
      const record = createRecord();
      const corrupt = {
        version: 1,
        files: { [OTHER_FILE_ID]: record },
      };

      expect(() => parseOwnedLocalFileManifest(corrupt))
        .toThrow('does not match record file ID');
    });

    it('rejects malformed or unexpected record fields in persisted data', () => {
      const record = createRecord();
      const wrongVersion = {
        ...record,
        version: 2,
      };
      const unexpectedUri = {
        ...record,
        uri: 'file:///tmp/arbitrary.jpg',
      };

      expect(() => parseOwnedLocalFileManifest({
        version: 1,
        files: { [FILE_ID]: wrongVersion },
      })).toThrow('record version must be 1');

      expect(() => parseOwnedLocalFileManifest({
        version: 1,
        files: { [FILE_ID]: unexpectedUri },
      })).toThrow('contains missing or unexpected fields');
    });

    it('rejects accessor-backed manifest fields as corruption', () => {
      const corrupt = { files: {} } as { version?: number; files: object };
      Object.defineProperty(corrupt, 'version', {
        enumerable: true,
        get: () => 1,
      });

      expect(() => parseOwnedLocalFileManifest(corrupt))
        .toThrow('must contain data properties only');
    });

    it('rejects symbol and hidden manifest file entries as corruption', () => {
      const symbolFiles = {
        [FILE_ID]: createRecord(),
        [Symbol('hidden-file')]: createRecord(),
      };
      const nonEnumerableFiles: Record<string, OwnedLocalFileManifestRecord> = {};
      Object.defineProperty(nonEnumerableFiles, FILE_ID, {
        enumerable: false,
        value: createRecord(),
      });

      expect(() => parseOwnedLocalFileManifest({ version: 1, files: symbolFiles }))
        .toThrow('must use string file IDs only');
      expect(() => parseOwnedLocalFileManifest({ version: 1, files: nonEnumerableFiles }))
        .toThrow('file entries must be enumerable');
    });
  });

  describe('membership, resolution, and read/delete authorization', () => {
    const manifest = createOwnedLocalFileManifest([createRecord()]);
    const resolvedPath = `${OWNED_ROOT}/${BASENAME}`;

    it('requires exact file membership and optional kind membership', () => {
      expect(isOwnedLocalFileManifestMember(manifest, FILE_ID)).toBe(true);
      expect(isOwnedLocalFileManifestMember(manifest, FILE_ID, 'photo')).toBe(true);
      expect(isOwnedLocalFileManifestMember(manifest, FILE_ID, 'project_document')).toBe(false);
      expect(isOwnedLocalFileManifestMember(manifest, OTHER_FILE_ID)).toBe(false);
    });

    it('resolves a member exactly one basename beneath file URI and POSIX roots', () => {
      expect(resolveOwnedLocalFilePath({
        ownedRoot: `${OWNED_ROOT}/`,
        manifest,
        fileId: FILE_ID,
        expectedKind: 'photo',
      })).toBe(resolvedPath);

      expect(resolveOwnedLocalFilePath({
        ownedRoot: '/data/app/owned',
        manifest,
        fileId: FILE_ID,
      })).toBe(`/data/app/owned/${BASENAME}`);
    });

    it('rejects nonmembers and kind mismatches', () => {
      expect(() => resolveOwnedLocalFilePath({
        ownedRoot: OWNED_ROOT,
        manifest,
        fileId: OTHER_FILE_ID,
      })).toThrow('is not present in the manifest');

      expect(() => resolveOwnedLocalFilePath({
        ownedRoot: OWNED_ROOT,
        manifest,
        fileId: FILE_ID,
        expectedKind: 'project_document',
      })).toThrow('is not authorized as project_document');
    });

    it.each([
      '',
      '/',
      'file:///',
      'relative/owned',
      'content://provider/owned',
      'https://example.com/owned',
      'file://host/owned',
      '/data/../owned',
      '/data/./owned',
      '/data//owned',
      '/data/%2e%2e/owned',
      '/data/%252e%252e/owned',
      '/data\\owned',
      '/data/owned?file=x',
      '/data/owned#fragment',
    ])('rejects unsafe owned root %p', ownedRoot => {
      expect(() => resolveOwnedLocalFilePath({
        ownedRoot,
        manifest,
        fileId: FILE_ID,
      })).toThrow();
    });

    it('authorizes only the exact canonical manifest member path', () => {
      const baseInput = {
        ownedRoot: OWNED_ROOT,
        manifest,
        fileId: FILE_ID,
        expectedKind: 'photo' as const,
      };

      expect(isOwnedLocalFileReadDeleteAuthorized({
        ...baseInput,
        candidatePath: resolvedPath,
      })).toBe(true);

      expect(isOwnedLocalFileReadDeleteAuthorized({
        ...baseInput,
        candidatePath: `file:///var/mobile/Containers/Data/Application/app/Documents/owned-other/${BASENAME}`,
      })).toBe(false);

      expect(isOwnedLocalFileReadDeleteAuthorized({
        ...baseInput,
        candidatePath: `${OWNED_ROOT}/${OTHER_FILE_ID}.jpg`,
      })).toBe(false);

      expect(isOwnedLocalFileReadDeleteAuthorized({
        ...baseInput,
        candidatePath: `file:///tmp/${BASENAME}`,
      })).toBe(false);
    });

    it('fails closed for corrupt manifests, unsafe roots, and kind mismatches', () => {
      expect(isOwnedLocalFileReadDeleteAuthorized({
        ownedRoot: OWNED_ROOT,
        manifest: { version: 2, files: {} },
        fileId: FILE_ID,
        candidatePath: resolvedPath,
      })).toBe(false);

      expect(isOwnedLocalFileReadDeleteAuthorized({
        ownedRoot: `${OWNED_ROOT}/../other`,
        manifest,
        fileId: FILE_ID,
        candidatePath: resolvedPath,
      })).toBe(false);

      expect(isOwnedLocalFileReadDeleteAuthorized({
        ownedRoot: OWNED_ROOT,
        manifest,
        fileId: FILE_ID,
        expectedKind: 'reference_document',
        candidatePath: resolvedPath,
      })).toBe(false);
    });
  });
});
