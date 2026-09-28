import { analysisComparedPriorPhoto } from '../../services/PhotoAnalysisPriorPhoto';

type Diagnostics = {
  selectedPriorPhotoId?: string | null;
  selectedPriorUpdateId?: string | null;
};

type Item = {
  update: { id: string };
  photo: {
    id: string;
    selectedAreaName: string;
    locationCapturedAt: string;
    photoIntelligence?: { diagnostics?: Diagnostics | null } | null;
  };
};

function item(
  updateId: string,
  photoId: string,
  areaName: string,
  capturedAt: string,
  diagnostics?: Diagnostics,
): Item {
  return {
    update: { id: updateId },
    photo: {
      id: photoId,
      selectedAreaName: areaName,
      locationCapturedAt: capturedAt,
      photoIntelligence: diagnostics === undefined ? null : { diagnostics },
    },
  };
}

// The analysis compared against a morning photo from another area. A newer
// Canopy A photo is what the desktop's area-name/time stand-in would show.
const analysedPrior = item('update-morning', 'photo-morning', 'Stair 2', '2026-07-18T09:00:00Z');
const newerSameArea = item('update-late', 'photo-late', 'Canopy A', '2026-07-18T11:00:00Z');

describe('analysisComparedPriorPhoto', () => {
  it('returns the prior the recorded analysis compared, not the newest same-area photo', () => {
    const selected = item('update-current', 'photo-current', 'Canopy A', '2026-07-18T12:00:00Z', {
      selectedPriorPhotoId: 'photo-morning',
      selectedPriorUpdateId: 'update-morning',
    });

    expect(analysisComparedPriorPhoto(selected, [selected, newerSameArea, analysedPrior]))
      .toBe(analysedPrior);
  });

  it('returns null when the named prior is not loaded, leaving the stand-in to the caller', () => {
    const selected = item('update-current', 'photo-current', 'Canopy A', '2026-07-18T12:00:00Z', {
      selectedPriorPhotoId: 'photo-archived',
      selectedPriorUpdateId: 'update-archived',
    });

    expect(analysisComparedPriorPhoto(selected, [selected, newerSameArea])).toBeNull();
  });

  it('returns null when the analysis names no prior', () => {
    const baseline = item('update-current', 'photo-current', 'Canopy A', '2026-07-18T12:00:00Z', {
      selectedPriorPhotoId: null,
    });
    const unanalysed = item('update-current', 'photo-current', 'Canopy A', '2026-07-18T12:00:00Z');

    expect(analysisComparedPriorPhoto(baseline, [baseline, newerSameArea])).toBeNull();
    expect(analysisComparedPriorPhoto(unanalysed, [unanalysed, newerSameArea])).toBeNull();
  });

  it('matches the named update as well as the photo id', () => {
    const selected = item('update-current', 'photo-current', 'Canopy A', '2026-07-18T12:00:00Z', {
      selectedPriorPhotoId: 'photo-morning',
      selectedPriorUpdateId: 'update-other',
    });

    expect(analysisComparedPriorPhoto(selected, [selected, analysedPrior])).toBeNull();
  });

  it('never returns the selected photo and ignores malformed stored ids', () => {
    const selfNamed = item('update-current', 'photo-current', 'Canopy A', '2026-07-18T12:00:00Z', {
      selectedPriorPhotoId: 'photo-current',
    });
    const malformed = item('update-current', 'photo-current', 'Canopy A', '2026-07-18T12:00:00Z', {
      selectedPriorPhotoId: 42 as unknown as string,
    });

    expect(analysisComparedPriorPhoto(selfNamed, [selfNamed, analysedPrior])).toBeNull();
    expect(analysisComparedPriorPhoto(malformed, [malformed, analysedPrior])).toBeNull();
  });
});
