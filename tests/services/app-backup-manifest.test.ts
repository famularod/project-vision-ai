import {
  AppBackupManifestError,
  createCompleteAppBackupManifest,
  verifyCompleteAppBackupManifest,
  verifyCompleteBackupAssetBytes,
  type CompleteAppBackupManifest,
} from '../../services/AppBackupManifest';

const REQUIRED = ['projects', 'updates', 'auth-artifacts'];
const SENSITIVE = ['auth-artifacts'];

function hash(value: string) {
  const marker = value.length.toString(16).padStart(64, '0');
  return marker.slice(-64);
}

const dependencies = {
  sha256Text: async (value: string) => hash(value),
  utf8ByteLength: (value: string) => value.length,
};

async function manifest(mode: 'replace' | 'merge' | 'validate_only' = 'replace') {
  return createCompleteAppBackupManifest({
    createdAt: '2026-07-22T12:00:00.000Z',
    restoreMode: mode,
    requiredDomainIds: REQUIRED,
    requiredSensitiveDomainIds: SENSITIVE,
    domains: [
      { id: 'projects', payload: [{ id: 'project-1' }] },
      { id: 'updates', payload: [] },
      {
        id: 'auth-artifacts',
        sensitive: true,
        itemCount: 1,
        payload: {
          format: 'encrypted',
          algorithm: 'AES-256-GCM',
          keyId: 'backup-key-1',
          ivBase64: 'YWJjZA==',
          ciphertextBase64: 'ZW5jcnlwdGVk',
          authTagBase64: 'dGFnMQ==',
        },
      },
    ],
    assets: [{
      id: 'document-1',
      kind: 'reference_document',
      relativePath: 'documents/document-1.pdf',
      sizeBytes: 4,
      sha256: 'a'.repeat(64),
    }],
  }, dependencies);
}

describe('complete app backup manifest contract', () => {
  it.each(['replace', 'merge', 'validate_only'] as const)(
    'creates and verifies the %s restore-mode envelope',
    async restoreMode => {
      const created = await manifest(restoreMode);

      await expect(verifyCompleteAppBackupManifest({
        manifest: created,
        requiredDomainIds: REQUIRED,
        requiredSensitiveDomainIds: SENSITIVE,
      }, dependencies)).resolves.toBe(created);

      expect(created.counts).toEqual({
        domainCount: 3,
        recordCount: 2,
        assetCount: 1,
        assetBytes: 4,
      });
    },
  );

  it('rejects a missing durable domain before a manifest can be created', async () => {
    await expect(createCompleteAppBackupManifest({
      createdAt: '2026-07-22T12:00:00.000Z',
      restoreMode: 'replace',
      requiredDomainIds: REQUIRED,
      requiredSensitiveDomainIds: SENSITIVE,
      domains: [
        { id: 'projects', payload: [] },
        {
          id: 'auth-artifacts',
          sensitive: true,
          itemCount: 0,
          payload: {
            format: 'encrypted',
            algorithm: 'AES-256-GCM',
            keyId: 'key',
            ivBase64: 'YWJjZA==',
            ciphertextBase64: 'ZW5jcnlwdGVk',
            authTagBase64: 'dGFnMQ==',
          },
        },
      ],
    }, dependencies)).rejects.toThrow('Missing: updates');
  });

  it('rejects plaintext content for a registered sensitive domain', async () => {
    await expect(createCompleteAppBackupManifest({
      createdAt: '2026-07-22T12:00:00.000Z',
      restoreMode: 'replace',
      requiredDomainIds: ['auth-artifacts'],
      requiredSensitiveDomainIds: ['auth-artifacts'],
      domains: [{
        id: 'auth-artifacts',
        payload: { accessToken: 'plaintext' },
      }],
    }, dependencies)).rejects.toThrow('must use the encrypted section contract');
  });

  it('rejects payload, count, and manifest tampering', async () => {
    const created = await manifest();
    const payloadTampered = {
      ...created,
      domains: created.domains.map(domain =>
        domain.id === 'projects'
          ? { ...domain, payload: [{ id: 'different-project' }] }
          : domain),
    } as CompleteAppBackupManifest;
    const countTampered = {
      ...created,
      counts: { ...created.counts, recordCount: 999 },
    } as CompleteAppBackupManifest;
    const manifestTampered = {
      ...created,
      manifestSha256: 'f'.repeat(64),
    } as CompleteAppBackupManifest;

    await expect(verifyCompleteAppBackupManifest({
      manifest: payloadTampered,
      requiredDomainIds: REQUIRED,
      requiredSensitiveDomainIds: SENSITIVE,
    }, dependencies)).rejects.toThrow(/byte count|checksum/);
    await expect(verifyCompleteAppBackupManifest({
      manifest: countTampered,
      requiredDomainIds: REQUIRED,
      requiredSensitiveDomainIds: SENSITIVE,
    }, dependencies)).rejects.toThrow('aggregate counts');
    await expect(verifyCompleteAppBackupManifest({
      manifest: manifestTampered,
      requiredDomainIds: REQUIRED,
      requiredSensitiveDomainIds: SENSITIVE,
    }, dependencies)).rejects.toThrow('manifest checksum');
  });

  it('rejects traversal paths and verifies actual asset bytes separately', async () => {
    await expect(createCompleteAppBackupManifest({
      createdAt: '2026-07-22T12:00:00.000Z',
      restoreMode: 'validate_only',
      requiredDomainIds: [],
      domains: [],
      assets: [{
        id: 'document-1',
        kind: 'project_document',
        relativePath: '%252e%252e%252fsecret.pdf',
        sizeBytes: 4,
        sha256: 'a'.repeat(64),
      }],
    }, dependencies)).rejects.toThrow('unsafe relative path');

    const created = await manifest();
    await expect(verifyCompleteBackupAssetBytes(
      created,
      async () => new Uint8Array([1, 2, 3, 4]),
      async () => 'a'.repeat(64),
    )).resolves.toBeUndefined();
    await expect(verifyCompleteBackupAssetBytes(
      created,
      async () => new Uint8Array([1]),
      async () => 'b'.repeat(64),
    )).rejects.toBeInstanceOf(AppBackupManifestError);
  });
});
