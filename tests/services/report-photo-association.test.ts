jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../../services/SupabaseService', () => ({
  listPIEExecutiveJudgmentsCloud: jest.fn(),
  savePIEExecutiveJudgmentCloud: jest.fn(),
}));

import {
  buildReportImageReferences,
  buildConstructionUnderstanding,
  collectReportEvidence,
} from '../../services/PIEReporter';
import type { ProjectUpdate, UpdatePhoto } from '../../types';

const PROJECT = '2321 Compliance Project';

function photo(
  id: string,
  areaName: string,
  caption: string,
): UpdatePhoto {
  return {
    id,
    uri: `file:///tmp/${id}.jpg`,
    caption,
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    selectedAreaName: areaName,
  };
}

function update(
  id: string,
  areaName: string,
  note: string,
  updatePhoto: UpdatePhoto,
): ProjectUpdate {
  return {
    id,
    projectName: PROJECT,
    date: '2026-07-30T12:00:00.000Z',
    photos: [updatePhoto],
    notes: note,
    recipients: { contactIds: [] },
    selectedAreaName: areaName,
    scheduleProjectName: PROJECT,
  };
}

describe('report photo association', () => {
  it('keeps source photos with their actual work area', () => {
    const eastPhoto = photo(
      'east-driveway-photo',
      'East Driveway',
      'Fresh asphalt was placed along the east driveway.',
    );
    const bbwPhoto = photo(
      'bbw-room-photo',
      'BBW-130',
      'Gunite wall installation is progressing inside BBW-130.',
    );
    const input = {
      selectedProjectNames: [PROJECT],
      savedUpdates: [
        update(
          'east-driveway-update',
          'East Driveway',
          'Concrete and asphalt work progressed at the East Driveway.',
          eastPhoto,
        ),
        update(
          'bbw-room-update',
          'BBW-130',
          'Gunite wall work progressed inside BBW-130.',
          bbwPhoto,
        ),
      ],
      scheduleItems: [],
    };

    const understanding = buildConstructionUnderstanding(
      input,
      collectReportEvidence(input),
    );
    const eastDriveway = understanding.workAreas.find(
      area => area.sourceEvidenceIds.includes('note-east-driveway-update'),
    );
    const bbwRoom = understanding.workAreas.find(
      area => area.sourceEvidenceIds.includes('note-bbw-room-update'),
    );

    expect(eastDriveway?.imageReferences.map(ref => ref.photoId)).toEqual([
      eastPhoto.id,
    ]);
    expect(bbwRoom?.imageReferences.map(ref => ref.photoId)).toEqual([
      bbwPhoto.id,
    ]);
  });

  it('does not inherit an East Driveway update area for legacy BBW photos', () => {
    const anchoredBBWPhoto: UpdatePhoto = {
      ...photo(
        'legacy-bbw-anchor-photo',
        '',
        'Gunite wall installation is progressing inside BBW-130.',
      ),
      continuityAnchor: {
        referencePhotoId: 'bbw-reference',
        projectName: PROJECT,
        areaName: 'BBW-130',
        instruction: 'Match the prior BBW wall view.',
        alignmentGuide: 'Frame the BBW wall.',
        confirmedAt: '2026-07-30T11:00:00.000Z',
      },
    };
    const captionedBBWPhoto = photo(
      'legacy-bbw-caption-photo',
      '',
      'Project photo from BBW-130',
    );
    const eastUpdate: ProjectUpdate = {
      ...update(
        'east-driveway-update-with-legacy-bbw-photos',
        'East Driveway',
        'Concrete was poured and finished at the East Driveway.',
        anchoredBBWPhoto,
      ),
      photos: [anchoredBBWPhoto, captionedBBWPhoto],
    };
    const input = {
      selectedProjectNames: [PROJECT],
      savedUpdates: [eastUpdate],
      scheduleItems: [],
    };

    const references = buildReportImageReferences(
      input.savedUpdates,
      input.selectedProjectNames,
    );
    expect(references).toEqual(expect.arrayContaining([
      expect.objectContaining({
        photoId: anchoredBBWPhoto.id,
        areaName: 'BBW-130',
      }),
      expect.objectContaining({
        photoId: captionedBBWPhoto.id,
        areaName: 'BBW-130',
      }),
    ]));

    const understanding = buildConstructionUnderstanding(
      input,
      collectReportEvidence(input),
    );
    const eastDriveway = understanding.workAreas.find(
      area => area.sourceEvidenceIds.includes(
        'note-east-driveway-update-with-legacy-bbw-photos',
      ),
    );
    const bbwRoom = understanding.workAreas.find(
      area => area.sourceEvidenceIds.includes(
        `photo-${anchoredBBWPhoto.id}`,
      ),
    );

    expect(eastDriveway?.imageReferences.map(ref => ref.photoId)).toEqual([]);
    expect(bbwRoom?.imageReferences.map(ref => ref.photoId)).toEqual([
      anchoredBBWPhoto.id,
      captionedBBWPhoto.id,
    ]);
  });

  it('quarantines photos with conflicting area metadata instead of placing them in a report area', () => {
    const conflictingPhoto: UpdatePhoto = {
      ...photo(
        'conflicting-area-photo',
        'East Driveway',
        'Project photo from East Driveway',
      ),
      continuityAnchor: {
        referencePhotoId: 'bbw-reference',
        projectName: PROJECT,
        areaName: 'BBW-130',
        instruction: 'Match the prior BBW wall view.',
        alignmentGuide: 'Frame the BBW wall.',
        confirmedAt: '2026-07-30T11:00:00.000Z',
      },
    };
    const input = {
      selectedProjectNames: [PROJECT],
      savedUpdates: [
        update(
          'conflicting-area-update',
          'East Driveway',
          'Concrete work progressed at the East Driveway.',
          conflictingPhoto,
        ),
      ],
      scheduleItems: [],
    };

    const references = buildReportImageReferences(
      input.savedUpdates,
      input.selectedProjectNames,
    );
    expect(references).toEqual([
      expect.objectContaining({
        photoId: conflictingPhoto.id,
        areaName: 'Needs Classification',
        classificationStatus: 'needs_classification',
      }),
    ]);

    const understanding = buildConstructionUnderstanding(
      input,
      collectReportEvidence(input),
    );
    expect(
      understanding.workAreas.flatMap(area => area.imageReferences),
    ).toEqual([]);
    expect(understanding.reviewFlags).toContain(
      '1 photo needs area classification before report use.',
    );
  });
});
