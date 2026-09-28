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
import {
  analyzeProjectPhotoWithVision,
  photoNeedsPriorRecheckAfterAreaChange,
} from '../../services/PIEPhotoVisionMobileWorkflow';
import {
  getCurrentSessionAccessToken,
  getSupabaseClient,
} from '../../services/SupabaseService';

const mockGetInfoAsync = FileSystem.getInfoAsync as jest.Mock;
const mockReadAsStringAsync = FileSystem.readAsStringAsync as jest.Mock;
const mockGetSize = Image.getSize as jest.Mock;
const mockGetSupabaseClient = getSupabaseClient as jest.Mock;
const mockGetCurrentSessionAccessToken = getCurrentSessionAccessToken as jest.Mock;

type Area = { id: string; name: string } | null;

const CANOPY: Area = { id: 'area-canopy', name: 'Canopy A' };
const STAIR: Area = { id: 'area-stair', name: 'Stair 2' };

function photo(id: string, capturedAt: string, area: Area): UpdatePhoto {
  return {
    id,
    uri: `file://${id}.jpg`,
    caption: '',
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    selectedAreaId: area?.id ?? null,
    selectedAreaName: area?.name ?? null,
    locationCapturedAt: capturedAt,
  };
}

function update(id: string, item: UpdatePhoto, area: Area): ProjectUpdate {
  return {
    id,
    projectName: '2375 Compliance Project',
    date: item.locationCapturedAt || '2026-07-18T12:00:00Z',
    photos: [item],
    notes: '',
    recipients: { contactIds: [] },
    selectedAreaId: area?.id ?? null,
    selectedAreaName: area?.name ?? null,
  };
}

// Mirrors App.tsx applyAreaAndLocationToDraft: the PM's area is stamped onto the
// update and every photo, and each photo keeps its stored analysis.
function withArea(target: ProjectUpdate, area: Area): ProjectUpdate {
  const fields = { selectedAreaId: area?.id ?? null, selectedAreaName: area?.name ?? null };
  return {
    ...target,
    ...fields,
    photos: target.photos.map(item => ({ ...item, ...fields })),
  };
}

// Runs the real prior selection. Evidence staging then stops on the stub
// client, which returns the retry state carrying the selection diagnostics.
async function analyze(current: UpdatePhoto, area: Area, priorUpdates: ProjectUpdate[]) {
  const currentUpdate = update(`${current.id}-update`, current, area);
  const result = await analyzeProjectPhotoWithVision({
    update: currentUpdate,
    photo: current,
    priorUpdates,
  });
  return {
    result,
    analyzedUpdate: {
      ...currentUpdate,
      photos: [{ ...current, photoIntelligence: result }],
    },
  };
}

describe('prior photo area pairing', () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReturnValue({ functions: { invoke: jest.fn() } });
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
    mockReadAsStringAsync.mockResolvedValue('ZmFrZQ==');
  });

  it('marks a pairing for a photo taken before an area was picked as area-unconfirmed', async () => {
    const stairPrior = photo('stair-prior', '2026-07-18T11:00:00Z', STAIR);
    const current = photo('no-area-current', '2026-07-18T12:00:00Z', null);

    const { result } = await analyze(current, null, [
      update('stair-prior-update', stairPrior, STAIR),
    ]);

    expect(result.diagnostics?.selectedPriorPhotoId).toBe('stair-prior');
    expect(result.diagnostics?.currentAreaKey).toBeNull();
    expect(result.diagnostics?.selectedPriorReason).toContain(
      'current photo has no area set, matched as area-unconfirmed fallback',
    );
    expect(result.diagnostics?.selectedPriorReason).not.toContain('same project and area');
  });

  it('still confirms a pairing when both photos carry the same area', async () => {
    const canopyPrior = photo('canopy-prior', '2026-07-18T11:00:00Z', CANOPY);
    const current = photo('canopy-current', '2026-07-18T12:00:00Z', CANOPY);

    const { result } = await analyze(current, CANOPY, [
      update('canopy-prior-update', canopyPrior, CANOPY),
    ]);

    expect(result.diagnostics?.selectedPriorPhotoId).toBe('canopy-prior');
    expect(result.diagnostics?.selectedPriorReason).toMatch(
      /^most recent valid earlier photo from same project and area/,
    );
    expect(result.diagnostics?.selectedPriorReason).not.toContain('area-unconfirmed');
  });

  it('rechecks a photo compared with no area once the PM picks one', async () => {
    const stairPrior = photo('stair-prior-2', '2026-07-18T11:00:00Z', STAIR);
    const current = photo('no-area-current-2', '2026-07-18T12:00:00Z', null);
    const { analyzedUpdate } = await analyze(current, null, [
      update('stair-prior-2-update', stairPrior, STAIR),
    ]);
    expect(analyzedUpdate.photos[0].photoIntelligence?.diagnostics?.noPriorReason).toBeNull();

    const relabelled = withArea(analyzedUpdate, CANOPY);

    expect(photoNeedsPriorRecheckAfterAreaChange(relabelled, relabelled.photos[0])).toBe(true);
  });

  it('rechecks a photo compared within a different area after the PM changes it', async () => {
    const stairPrior = photo('stair-prior-3', '2026-07-18T11:00:00Z', STAIR);
    const current = photo('stair-current-3', '2026-07-18T12:00:00Z', STAIR);
    const { analyzedUpdate } = await analyze(current, STAIR, [
      update('stair-prior-3-update', stairPrior, STAIR),
    ]);
    expect(analyzedUpdate.photos[0].photoIntelligence?.diagnostics?.selectedPriorPhotoId)
      .toBe('stair-prior-3');

    const relabelled = withArea(analyzedUpdate, CANOPY);

    expect(photoNeedsPriorRecheckAfterAreaChange(relabelled, relabelled.photos[0])).toBe(true);
  });

  it('does not recheck when the PM re-picks the area the comparison already used', async () => {
    const canopyPrior = photo('canopy-prior-4', '2026-07-18T11:00:00Z', CANOPY);
    const current = photo('canopy-current-4', '2026-07-18T12:00:00Z', CANOPY);
    const { analyzedUpdate } = await analyze(current, CANOPY, [
      update('canopy-prior-4-update', canopyPrior, CANOPY),
    ]);

    const relabelled = withArea(analyzedUpdate, CANOPY);

    expect(photoNeedsPriorRecheckAfterAreaChange(relabelled, relabelled.photos[0])).toBe(false);
  });

  it('keeps rechecking a photo that found no prior for lack of an area', async () => {
    const current = photo('no-area-first', '2026-07-18T12:00:00Z', null);
    const { analyzedUpdate } = await analyze(current, null, []);
    expect(analyzedUpdate.photos[0].photoIntelligence?.diagnostics?.noPriorReason)
      .toBe('missing_area_key');

    const relabelled = withArea(analyzedUpdate, CANOPY);

    expect(photoNeedsPriorRecheckAfterAreaChange(relabelled, relabelled.photos[0])).toBe(true);
  });

  it('does not recheck a photo whose analysis has not finished', () => {
    const current = photo('analyzing-current', '2026-07-18T12:00:00Z', CANOPY);
    const draft = update('analyzing-update', current, CANOPY);

    expect(photoNeedsPriorRecheckAfterAreaChange(draft, current)).toBe(false);
  });
});
