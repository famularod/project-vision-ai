/**
 * Open item 3.26 (GPS item 3): a photo chosen from the library was not placed
 * by the location stored inside it. It kept no GPS and was filed under the
 * update's area, the one the phone's own position suggested.
 *
 * Now its own location (the photo's EXIF GPS, read through the image
 * picker's own `exif` option) is the photo's GPS, and when that location is
 * clearly inside one of the project's saved areas the photo is filed under
 * that area, and stays there when the update's area is changed. It is never
 * taken for where you are now. A photo without one is handled as before.
 */
import fs from 'fs';
import path from 'path';

import { asLibraryPhoto, withDraftLocation } from '../../services/DraftPhotoGps';
import {
  libraryPhotoGpsFromExif,
  libraryPhotoLocationLine,
  libraryPhotoPlacement,
} from '../../services/LibraryPhotoLocation';
import { extractGPSEvidence, extractPhotoEvidence } from '../../services/PIEEvidenceFusion';
import type { ProjectArea } from '../../types';

const PROJECT = 'Harbor Test Project';
const SAVED = '2026-10-01T10:00:00.000Z';
/** About 364 ft north of the gate: the two areas are far apart. */
const NORTH = 0.001;
const gate: ProjectArea = { id: 'area-gate', name: 'Gate Yard', projectName: PROJECT, latitude: 40, longitude: -75, radiusFeet: 75, locationCapturedAt: SAVED };
const tower: ProjectArea = { id: 'area-tower', name: 'Tower Base', projectName: PROJECT, latitude: 40 + NORTH, longitude: -75, radiusFeet: 75, locationCapturedAt: SAVED };
const areas = [gate, tower];

/** What the iPhone's picker returns for a photo taken at the tower (GPS in degrees, hemisphere apart). */
const iPhoneExif = {
  DateTimeOriginal: '2026:10:10 09:15:00',
  GPSLatitude: 40 + NORTH,
  GPSLatitudeRef: 'N',
  GPSLongitude: 75,
  GPSLongitudeRef: 'W',
  GPSHPositioningError: 5,
};

/** A photo as Add Photos makes it before it is marked as a library photo: the draft's area (Gate Yard) and fix. */
function photoInDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'photo-1',
    uri: 'file:///photo-1.jpg',
    caption: '',
    selectedAreaId: gate.id,
    selectedAreaName: gate.name,
    gpsLatitude: 40,
    gpsLongitude: -75,
    gpsAccuracy: 4,
    distanceFromSelectedAreaFeet: 0,
    locationCapturedAt: '2026-10-14T09:00:00.000Z',
    ...overrides,
  };
}

describe('3.26: the location stored in a library photo', () => {
  it('is read from the picker\'s EXIF on the iPhone (degrees and hemisphere apart) and on Android (signed)', () => {
    expect(libraryPhotoGpsFromExif(iPhoneExif)).toEqual({ gpsLatitude: 40 + NORTH, gpsLongitude: -75, gpsAccuracy: 5 });
    expect(libraryPhotoGpsFromExif({ GPSLatitude: -33.5, GPSLatitudeRef: 'S', GPSLongitude: 151.2, GPSLongitudeRef: 'E' }))
      .toEqual({ gpsLatitude: -33.5, gpsLongitude: 151.2, gpsAccuracy: null });
    expect(libraryPhotoGpsFromExif({ GPSLatitude: 33.5, GPSLatitudeRef: 'S', GPSLongitude: 151.2, GPSLongitudeRef: 'E' }))
      .toEqual({ gpsLatitude: -33.5, gpsLongitude: 151.2, gpsAccuracy: null });
    expect(libraryPhotoGpsFromExif({ GPSLatitude: 40.001, GPSLongitude: -75, GPSHPositioningError: '12' }))
      .toEqual({ gpsLatitude: 40.001, gpsLongitude: -75, gpsAccuracy: 12 });
  });

  it('is none for a photo without one, a 0/0 location, or a value that is not a place', () => {
    expect(libraryPhotoGpsFromExif(undefined)).toBeNull();
    expect(libraryPhotoGpsFromExif(null)).toBeNull();
    expect(libraryPhotoGpsFromExif({ DateTimeOriginal: '2026:10:10 09:15:00' })).toBeNull();
    expect(libraryPhotoGpsFromExif({ GPSLatitude: 40 })).toBeNull();
    expect(libraryPhotoGpsFromExif({ GPSLatitude: 0, GPSLongitude: 0 })).toBeNull();
    expect(libraryPhotoGpsFromExif({ GPSLatitude: 95, GPSLongitude: -75 })).toBeNull();
    expect(libraryPhotoGpsFromExif({ GPSLatitude: '40/1,0/1,0/1', GPSLongitude: -75 })).toBeNull();
    expect(libraryPhotoGpsFromExif({ GPSLatitude: 40, GPSLongitude: -75, GPSHPositioningError: -1 }))
      .toEqual({ gpsLatitude: 40, gpsLongitude: -75, gpsAccuracy: null });
  });
});

describe('3.26: a library photo is placed by its own location, before the update\'s', () => {
  it('inside a saved area: filed under that area, with its own GPS (the update was at the gate)', () => {
    const photo = asLibraryPhoto(photoInDraft(), libraryPhotoGpsFromExif(iPhoneExif), areas);
    expect(photo).toMatchObject({
      pickedFromLibrary: true,
      selectedAreaId: tower.id,
      selectedAreaName: tower.name,
      gpsLatitude: 40 + NORTH,
      gpsLongitude: -75,
      gpsAccuracy: 5,
    });
    expect(photo.distanceFromSelectedAreaFeet).toBeLessThan(1);
    expect(libraryPhotoLocationLine(photo, areas)).toBe("Placed by the photo's own location: Tower Base");
  });

  it('without a location of its own: as before (the update\'s area, no GPS, no line)', () => {
    const before = asLibraryPhoto(photoInDraft());
    const photo = asLibraryPhoto(photoInDraft(), libraryPhotoGpsFromExif({}), areas);
    expect(photo).toEqual(before);
    expect(photo).toMatchObject({
      pickedFromLibrary: true,
      selectedAreaId: gate.id,
      gpsLatitude: null,
      gpsLongitude: null,
      gpsAccuracy: null,
      distanceFromSelectedAreaFeet: null,
    });
    expect(libraryPhotoLocationLine(photo, areas)).toBeNull();
  });

  it('outside every saved area, or too imprecise to tell: the update\'s area, its own GPS kept, and a line that says so', () => {
    const far = asLibraryPhoto(photoInDraft(), { gpsLatitude: 40.01, gpsLongitude: -75, gpsAccuracy: 5 }, areas);
    expect(far).toMatchObject({ selectedAreaId: gate.id, gpsLatitude: 40.01, distanceFromSelectedAreaFeet: null });
    expect(libraryPhotoLocationLine(far, areas)).toBe(
      "Location taken from the photo. It is not clearly inside one saved area, so the update's area is used.",
    );
    const unknownPrecision = asLibraryPhoto(photoInDraft(), { gpsLatitude: 40 + NORTH, gpsLongitude: -75, gpsAccuracy: null }, areas);
    expect(unknownPrecision).toMatchObject({ selectedAreaId: gate.id, gpsLatitude: 40 + NORTH });
    expect(libraryPhotoPlacement(unknownPrecision, areas)).toBeNull();
  });

  it('keeps its own area when the update\'s area is changed; a library photo without one takes the new area, as before', () => {
    const placed = asLibraryPhoto(photoInDraft(), libraryPhotoGpsFromExif(iPhoneExif), areas);
    const plain = asLibraryPhoto(photoInDraft());
    const far = asLibraryPhoto(photoInDraft(), { gpsLatitude: 40.01, gpsLongitude: -75, gpsAccuracy: 5 }, areas);
    const toGate = {
      selectedAreaId: gate.id,
      selectedAreaName: gate.name,
      gpsLatitude: 40,
      gpsLongitude: -75,
      gpsAccuracy: 4,
      distanceFromSelectedAreaFeet: 0,
      locationCapturedAt: '2026-10-14T09:05:00.000Z',
    };
    expect(withDraftLocation(placed, toGate, areas)).toEqual(placed);
    expect(withDraftLocation(plain, toGate, areas)).toEqual({ ...plain, selectedAreaId: gate.id, selectedAreaName: gate.name });
    expect(withDraftLocation(far, toGate, areas)).toEqual({ ...far, selectedAreaId: gate.id, selectedAreaName: gate.name });
    // A caller that does not pass the areas works as before.
    expect(withDraftLocation(placed, toGate)).toEqual({ ...placed, selectedAreaId: gate.id, selectedAreaName: gate.name });
  });
});

describe('3.26: a library photo\'s own location is never taken for where you are now', () => {
  it('the update\'s own fix stays the latest location; the library photo picked after it does not replace it', () => {
    const update = {
      id: 'update-1',
      projectName: PROJECT,
      date: '2026-10-14',
      notes: '',
      selectedAreaId: gate.id,
      selectedAreaName: gate.name,
      gpsLatitude: 40,
      gpsLongitude: -75,
      gpsAccuracy: 4,
      locationCapturedAt: '2026-10-14T09:00:00.000Z',
      photos: [{
        ...asLibraryPhoto(photoInDraft({ locationCapturedAt: '2026-10-14T09:10:00.000Z' }), libraryPhotoGpsFromExif(iPhoneExif), areas),
        category: 'Update',
        actionRequired: '',
        actionOwner: '',
        actionDueDate: '',
        actionStatus: 'Open',
      }],
    };
    const photoEvidence = extractPhotoEvidence({ projectName: PROJECT, updates: [update as never] });
    expect(photoEvidence[0]).toMatchObject({ areaName: tower.name, hasGps: true });
    const gps = extractGPSEvidence({ projectName: PROJECT, updates: [update as never], photoEvidence, projectAreas: areas });
    expect(gps).toMatchObject({ latitude: 40, longitude: -75, recommendedArea: gate.name });
  });
});

describe('3.26: Add Photos asks the picker for the photo\'s own location, and shows where it placed it', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
  const between = (start: string, end: string) => {
    const from = app.indexOf(start);
    expect(from).toBeGreaterThan(-1);
    return app.slice(from, app.indexOf(end, from + start.length));
  };

  it('Choose from library reads EXIF and gives each photo its own location and the project\'s areas', () => {
    const pickPhotos = between('async function pickPhotos()', 'async function takePhoto(');
    expect(pickPhotos).toMatch(/launchImageLibraryAsync\(\{[^}]*\bexif: true,/);
    expect(pickPhotos).toMatch(/asLibraryPhoto\(\s*withDraftPhotoContext\(await photoFromAsset\(asset\), draftRef\.current\),\s*libraryPhotoGpsFromExif\(asset\.exif\),\s*libraryAreas,?\s*\)/);
    // The cover photo and the screenshot import ask for nothing more than before.
    expect(between('async function chooseProjectCoverFromLibrary(', 'async function takeNewProjectCoverPhoto(')).not.toMatch(/exif/);
  });

  it('a change of the update\'s area passes the project\'s areas, so a placed photo keeps its own', () => {
    const apply = between('function applyAreaAndLocationToDraft(', 'function ');
    expect(apply).toMatch(/withDraftLocation\(photo, locationFields, draftProjectAreas\)/);
  });

  it('each photo card shows the line', () => {
    expect(app).toMatch(/locationLine=\{libraryPhotoLocationLine\(photo, projectAreas\)\}/);
    const card = between('function PhotoCard({', 'RootPhotoIntelligenceCard');
    expect(card).toMatch(/\{locationLine \? \(\s*<Text style=\{styles\.bodyText\}>\{locationLine\}<\/Text>\s*\) : null\}/);
  });
});
