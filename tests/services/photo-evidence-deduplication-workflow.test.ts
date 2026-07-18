jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(),
}));

jest.mock('react-native', () => ({
  Image: { getSize: jest.fn() },
}));

jest.mock('../../services/SupabaseService', () => ({
  getSupabaseClient: jest.fn(),
  getCurrentSessionAccessToken: jest.fn(),
}));

import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { Image } from 'react-native';
import type { ProjectUpdate, UpdatePhoto } from '../../types';
import { analyzeProjectPhotoWithVision } from '../../services/PIEPhotoVisionMobileWorkflow';
import { CURRENT_PHOTO_ANALYSIS_VERSIONS } from '../../services/PhotoAnalysisIdentity';
import {
  getCurrentSessionAccessToken,
  getSupabaseClient,
} from '../../services/SupabaseService';

const mockGetInfoAsync = FileSystem.getInfoAsync as jest.Mock;
const mockReadAsStringAsync = FileSystem.readAsStringAsync as jest.Mock;
const mockGetSize = Image.getSize as jest.Mock;
const mockDigest = Crypto.digest as jest.Mock;
const mockGetSupabaseClient = getSupabaseClient as jest.Mock;
const mockGetCurrentSessionAccessToken = getCurrentSessionAccessToken as jest.Mock;

function photo(id: string, uri: string, capturedAt: string): UpdatePhoto {
  return {
    id,
    uri,
    caption: 'Same field condition',
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    selectedAreaId: 'area-1',
    selectedAreaName: 'Canopy A',
    locationCapturedAt: capturedAt,
  };
}

function update(id: string, item: UpdatePhoto): ProjectUpdate {
  return {
    id,
    projectName: '2375 Compliance Project',
    date: item.locationCapturedAt || '2026-07-18T12:00:00Z',
    photos: [item],
    notes: '',
    recipients: { contactIds: [] },
    selectedAreaId: 'area-1',
    selectedAreaName: 'Canopy A',
  };
}

describe('duplicate photo evidence workflow', () => {
  it('persists explicit lineage for duplicate bytes and returns a non-failure result', async () => {
    const evidenceRows: Record<string, unknown>[] = [];
    const assetRows: Record<string, unknown>[] = [];
    const uploads: string[] = [];
    const invoke = jest.fn();

    const query = (table: string) => {
      const execute = async () => ({
        data: table === 'pie_evidence_records' ? evidenceRows : assetRows,
        error: null,
      });
      const builder: Record<string, unknown> = {
        eq: jest.fn(() => builder),
        order: jest.fn(execute),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          execute().then(resolve, reject),
      };
      return builder;
    };

    const client = {
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } } })),
      },
      storage: {
        from: jest.fn(() => ({
          upload: jest.fn(async (path: string) => {
            uploads.push(path);
            return { error: null };
          }),
        })),
      },
      functions: { invoke },
      from: jest.fn((table: string) => ({
        select: jest.fn(() => query(table)),
        upsert: jest.fn(async (payload: Record<string, unknown>) => {
          if (table === 'pie_evidence_records') evidenceRows.push(payload);
          if (table === 'pie_photo_assets') assetRows.push(payload);
          return { error: null };
        }),
      })),
    };

    mockGetSupabaseClient.mockReturnValue(client);
    mockGetCurrentSessionAccessToken.mockResolvedValue({
      ok: true,
      data: {
        status: 'token_present',
        accessToken: 'token',
        userId: 'user-1',
        missingReason: null,
        authState: 'signed_in',
        appAuthMode: 'supabase_authenticated',
      },
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1_024 });
    mockGetSize.mockResolvedValue({ width: 1_600, height: 1_200 });
    mockReadAsStringAsync.mockResolvedValue('aWRlbnRpY2FsLWJ5dGVz');
    mockDigest.mockResolvedValue(new Uint8Array(32).fill(7).buffer);

    const current = photo('current-photo', 'file://current.jpg', '2026-07-18T12:00:00Z');
    const prior = photo('prior-photo', 'file://prior.jpg', '2026-07-18T11:00:00Z');
    const result = await analyzeProjectPhotoWithVision({
      update: update('current-update', current),
      photo: current,
      priorUpdates: [update('prior-update', prior)],
    });

    expect(mockGetInfoAsync.mock.calls).toEqual([
      ['file://current.jpg'],
      ['file://prior.jpg'],
    ]);

    // Included before status so an unexpected fallback reports its root cause.
    expect(result.diagnostics?.providerResponseStatus).toBe('duplicate_bytes_resolved');

    expect(result.status).toBe('completed_with_limitations');
    expect(result.title).toBe('Duplicate photo recognized');
    expect(result.projectProgress).toBe('unsupported');
    expect(result.diagnostics?.edgeFunctionInvoked).toBe(false);
    expect(invoke).not.toHaveBeenCalled();

    expect(evidenceRows).toHaveLength(2);
    expect(evidenceRows.map(row => row.evidence_version)).toEqual([1, 2]);
    expect(evidenceRows[1].analyzer_version).toBe(
      CURRENT_PHOTO_ANALYSIS_VERSIONS.analyzerVersion,
    );
    expect(evidenceRows[1].lineage).toEqual({
      parentEvidenceIds: [evidenceRows[0].id],
      derivedEvidenceIds: [],
      analyzerRunIds: [],
      correctionIds: [],
    });

    expect(assetRows).toHaveLength(2);
    expect(assetRows[0].duplicate_of_evidence_id).toBeNull();
    expect(assetRows[1].duplicate_of_evidence_id).toBe(evidenceRows[0].id);
    expect(assetRows[1].current_analysis_version).toBeNull();
    expect(assetRows[1].original_storage_path).toBe(assetRows[0].original_storage_path);
    expect(uploads).toHaveLength(1);
  });
});
