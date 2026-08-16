const mockInvokeProvider = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(async () => new Uint8Array(32).buffer),
}));

jest.mock('react-native', () => {
  return {
    Image: { getSize: jest.fn() },
    NativeModules: {},
    Platform: {
      OS: 'ios',
      select: (values: Record<string, unknown>) =>
        values.ios ?? values.native ?? values.default,
    },
    TurboModuleRegistry: { get: jest.fn(() => null) },
  };
});

jest.mock('../../services/SupabaseService', () => ({
  getSupabaseClient: jest.fn(),
  getCurrentSessionAccessToken: jest.fn(),
}));

import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'react-native';
import type { ProjectUpdate, UpdatePhoto } from '../../types';
import { analyzeProjectPhotoWithVision } from '../../services/PIEPhotoVisionMobileWorkflow';
import {
  getCurrentSessionAccessToken,
  getSupabaseClient,
} from '../../services/SupabaseService';
import {
  MAX_PHOTO_DIMENSION_PIXELS,
  MAX_PHOTO_SOURCE_BYTES,
  prepareSelectedPhotoPair,
  readPhotoBase64WithinLimits,
  selectWinningPriorPhotoCandidate,
} from '../../services/PhotoPairPreparation';

const mockGetInfoAsync = FileSystem.getInfoAsync as jest.Mock;
const mockReadAsStringAsync = FileSystem.readAsStringAsync as jest.Mock;
const mockGetSize = Image.getSize as jest.Mock;
const mockGetSupabaseClient = getSupabaseClient as jest.Mock;
const mockGetCurrentSessionAccessToken = getCurrentSessionAccessToken as jest.Mock;

function photo(id: string, uri: string, locationCapturedAt: string): UpdatePhoto {
  return {
    id,
    uri,
    caption: 'Same work area',
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    selectedAreaId: 'area-1',
    selectedAreaName: 'Canopy A',
    locationCapturedAt,
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

describe('metadata-first photo pair preparation', () => {
  beforeEach(() => {
    mockGetInfoAsync.mockReset();
    mockReadAsStringAsync.mockReset();
    mockGetSize.mockReset();
    mockInvokeProvider.mockReset();
    mockGetSupabaseClient.mockReset();
    mockGetCurrentSessionAccessToken.mockReset();
    mockGetSupabaseClient.mockReturnValue({ functions: { invoke: mockInvokeProvider } });
    mockGetCurrentSessionAccessToken.mockResolvedValue({
      ok: false,
      data: null,
      error: 'session unavailable in test',
    });
  });

  it('ranks a large metadata set and prepares only the current photo plus one winning prior', async () => {
    const candidates = Array.from({ length: 10_000 }, (_, index) => ({
      photo: { id: `prior-${index}` },
      continuityScore: index % 7,
      capturedAt: index,
      candidateIndex: index + 1,
    }));
    const selected = selectWinningPriorPhotoCandidate(candidates, []);
    const prepare = jest.fn(async (item: { id: string }, role: 'current' | 'prior') => ({
      ok: true,
      id: item.id,
      role,
    }));

    expect(selected?.photo.id).toBe('prior-9995');
    await prepareSelectedPhotoPair({
      currentPhoto: { id: 'current' },
      priorPhoto: selected!.photo,
      prepare,
    });

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls).toEqual([
      [{ id: 'current' }, 'current'],
      [{ id: 'prior-9995' }, 'prior'],
    ]);
  });

  it('the live workflow inspects and encodes only one prior after ranking a large candidate set', async () => {
    const current = photo('current', 'file://current.jpg', '2026-07-18T12:00:00Z');
    const priorUpdates = Array.from({ length: 1_000 }, (_, index) => {
      const capturedAt = new Date(
        Date.parse('2026-07-18T12:00:00Z') - (1_000 - index) * 60_000,
      ).toISOString();
      return update(
        `update-${index}`,
        photo(`prior-${index}`, `file://prior-${index}.jpg`, capturedAt),
      );
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1_024 });
    mockGetSize.mockResolvedValue({ width: 1_600, height: 1_200 });
    mockReadAsStringAsync.mockResolvedValue('ZmFrZQ==');

    const onTargetPrepared = jest.fn();
    await analyzeProjectPhotoWithVision({
      update: update('current-update', current),
      photo: current,
      priorUpdates,
      onTargetPrepared,
    });

    expect(mockGetInfoAsync.mock.calls).toEqual([
      ['file://current.jpg'],
      ['file://prior-999.jpg'],
    ]);
    expect(mockReadAsStringAsync.mock.calls.map(call => call[0])).toEqual([
      'file://current.jpg',
      'file://prior-999.jpg',
    ]);
    expect(mockInvokeProvider).not.toHaveBeenCalled();
    expect(onTargetPrepared).toHaveBeenCalledWith({
      projectId: 'project-2375-compliance-project',
      updateId: 'current-update',
      photoId: 'current',
      contentSha256: '0'.repeat(64),
      capturedAt: '2026-07-18T12:00:00Z',
    });
  });

  it('does not read base64 when bytes or dimensions violate the source limits', async () => {
    const readOversized = jest.fn(async () => 'oversized');
    const readInvalidDimensions = jest.fn(async () => 'invalid-dimensions');
    const readOversizedDimensions = jest.fn(async () => 'oversized-dimensions');

    await expect(readPhotoBase64WithinLimits({
      sizeBytes: MAX_PHOTO_SOURCE_BYTES + 1,
      width: 100,
      height: 100,
    }, readOversized)).resolves.toEqual({ ok: false, reason: 'too_large' });
    await expect(readPhotoBase64WithinLimits({
      sizeBytes: 1_024,
      width: 0,
      height: 100,
    }, readInvalidDimensions)).resolves.toEqual({
      ok: false,
      reason: 'invalid_dimensions',
    });
    await expect(readPhotoBase64WithinLimits({
      sizeBytes: 1_024,
      width: MAX_PHOTO_DIMENSION_PIXELS + 1,
      height: 100,
    }, readOversizedDimensions)).resolves.toEqual({
      ok: false,
      reason: 'dimensions_too_large',
    });

    expect(readOversized).not.toHaveBeenCalled();
    expect(readInvalidDimensions).not.toHaveBeenCalled();
    expect(readOversizedDimensions).not.toHaveBeenCalled();
  });

  it('rejects an oversized current image before dimensions, base64, or provider invocation', async () => {
    const current = photo('current', 'file://current-large.jpg', '2026-07-18T12:00:00Z');
    const prior = photo('prior', 'file://prior.jpg', '2026-07-18T11:00:00Z');
    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      size: MAX_PHOTO_SOURCE_BYTES + 1,
    });

    const result = await analyzeProjectPhotoWithVision({
      update: update('current-update', current),
      photo: current,
      priorUpdates: [update('prior-update', prior)],
    });

    expect(result.diagnostics?.imagePrepareFailureReason).toBe('current_photo_too_large');
    expect(mockGetSize).not.toHaveBeenCalled();
    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
    expect(mockInvokeProvider).not.toHaveBeenCalled();
  });

  it('rejects invalid prior dimensions before encoding that prior or invoking the provider', async () => {
    const current = photo('current', 'file://current.jpg', '2026-07-18T12:00:00Z');
    const prior = photo('prior', 'file://prior-invalid.jpg', '2026-07-18T11:00:00Z');
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1_024 });
    mockGetSize
      .mockResolvedValueOnce({ width: 1_600, height: 1_200 })
      .mockResolvedValueOnce({ width: 0, height: 1_200 });
    mockReadAsStringAsync.mockResolvedValue('ZmFrZQ==');

    const result = await analyzeProjectPhotoWithVision({
      update: update('current-update', current),
      photo: current,
      priorUpdates: [update('prior-update', prior)],
    });

    expect(result.diagnostics?.imagePrepareFailureReason).toBe('prior_photo_invalid_dimensions');
    expect(mockReadAsStringAsync.mock.calls.map(call => call[0])).toEqual([
      'file://current.jpg',
    ]);
    expect(mockInvokeProvider).not.toHaveBeenCalled();
  });
});
