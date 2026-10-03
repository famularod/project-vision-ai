/**
 * Whole-app audit A4 pass 7 M2 (30 Sep 2026): the pass 6 fix signed photos
 * taken on the other device when shown in lists, but photo comparisons, the
 * Before/After row and project covers still took the photo's `uri`, which is
 * empty for such a photo, so they showed nothing. Renders the real
 * comparison, Before/After row and cover image with the real resolvers,
 * comparison builder and SyncService signing; only the Supabase signing call
 * is mocked.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import {
  PhotoComparisonPreviewRow,
  SavedFieldUpdatesContext,
} from '../../components/photo-comparison-preview-row';
import { ProjectPhotoImage } from '../../components/ProjectPhotoImage';
import {
  UpdatePhotoComparison,
  updatePhotoComparisonViewModel,
} from '../../components/updates-workspace-layout';
import { buildDAVEUpdatePhotoComparison } from '../../services/DAVEUpdateWorkspace';
import { mostRecentProjectHeroPhoto, resolveProjectCoverImage } from '../../services/ProjectCoverImage';
import { createPhotoSignedUrl } from '../../services/SupabaseService';
import type { ProjectUpdate, UpdatePhoto } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/SupabaseService', () => ({
  ...jest.requireActual('../../services/SupabaseService'),
  createPhotoSignedUrl: jest.fn(),
}));

const signedUrl = createPhotoSignedUrl as jest.Mock;
const signedFor = (path: string) => `https://signed.example/${path}?preview`;
const HERE = 'file:///var/mobile/Containers/Data/Application/NEW/Documents/project-photos/';
/** This device's file for a photo: only paths in its own photo folder (as resolveProjectPhotoUri). */
const localUri = (photo: Partial<UpdatePhoto>) => (photo.uri?.startsWith(HERE) ? photo.uri : '');

beforeEach(() => {
  signedUrl.mockReset().mockImplementation(async (path: string) => ({ ok: true, stubbed: false, data: signedFor(path) }));
});

/** A photo taken on the other device: its path was cleared here (audit A7 M3). */
const cloudOnly = (id: string, updateId: string, extra: Partial<UpdatePhoto> = {}): UpdatePhoto => ({
  id, uri: '', caption: '', category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '',
  actionStatus: 'Open', fileName: `IMG_${id}.jpg`, mimeType: 'image/jpeg',
  cloudStoragePath: `canopy-b/${updateId}/${id}-IMG_${id}.jpg`, ...extra,
} as UpdatePhoto);
const fieldUpdate = (id: string, date: string, photos: UpdatePhoto[]) =>
  ({ id, projectName: 'Canopy B', date, recipients: { contactIds: [] }, status: 'sent', photos } as unknown as ProjectUpdate);
const analysed = (priorPhotoId: string, priorPhotoUri = '') => ({
  status: 'analysis_complete', title: 'Visible change', summary: 'Panels now cover the east elevation.',
  changedFromPrior: 'Panels now cover the east elevation.', userReview: null, priorPhotoUri,
  diagnostics: { selectedPriorPhotoId: priorPhotoId },
}) as unknown as NonNullable<UpdatePhoto['photoIntelligence']>;

const prior = fieldUpdate('u-prior', '2026-09-20', [cloudOnly('p-prior', 'u-prior')]);
const current = fieldUpdate('u-now', '2026-09-29', [cloudOnly('p-now', 'u-now', { photoIntelligence: analysed('p-prior') })]);
const sources = () => screen.UNSAFE_getAllByType(ProjectPhotoImage)
  .map(image => image.findByType(require('react-native').Image).props.source.uri);

describe('photos taken on the other device (A4 pass 7 M2)', () => {
  it('the Updates photo comparison shows both photos, signed when shown', async () => {
    const comparison = updatePhotoComparisonViewModel(
      buildDAVEUpdatePhotoComparison(current, [prior, current]), date => date, localUri);
    expect(comparison).not.toBeNull();
    await render(<UpdatePhotoComparison comparison={comparison!} />);
    await waitFor(() => expect(sources()).toEqual([
      signedFor('canopy-b/u-prior/p-prior-IMG_p-prior.jpg'),
      signedFor('canopy-b/u-now/p-now-IMG_p-now.jpg'),
    ]));
  });

  it('the Before/After row of a photo shows, with the prior photo found in the saved updates', async () => {
    const photo = current.photos[0];
    // The stored prior path is the analysing device's own: no file here.
    const result = analysed('p-prior', 'file:///var/mobile/Containers/Data/Application/OTHER/Documents/project-photos/x.jpg');
    await render(
      <SavedFieldUpdatesContext.Provider value={[prior, current]}>
        <PhotoComparisonPreviewRow result={result as never} photo={photo} projectName="Canopy B" localUri={localUri} />
      </SavedFieldUpdatesContext.Provider>,
    );
    expect(screen.getByTestId('photo-comparison-preview-row')).toBeTruthy();
    await waitFor(() => expect(sources()).toEqual([
      signedFor('canopy-b/u-prior/p-prior-IMG_p-prior.jpg'),
      signedFor('canopy-b/u-now/p-now-IMG_p-now.jpg'),
    ]));
  });

  it('the Before/After row stays hidden when the prior photo cannot be shown on this device', async () => {
    const result = analysed('missing', 'file:///var/mobile/Containers/Data/Application/OTHER/Documents/project-photos/x.jpg');
    await render(
      <SavedFieldUpdatesContext.Provider value={[current]}>
        <PhotoComparisonPreviewRow result={result as never} photo={current.photos[0]} projectName="Canopy B" localUri={localUri} />
      </SavedFieldUpdatesContext.Provider>,
    );
    expect(screen.queryByTestId('photo-comparison-preview-row')).toBeNull();
  });

  it('the project cover is the newest photo, signed when shown; one with nothing to show is passed over', async () => {
    const lost = { ...cloudOnly('p-lost', 'u-newest'), cloudStoragePath: undefined } as UpdatePhoto;
    const newest = fieldUpdate('u-newest', '2026-09-30', [lost, cloudOnly('p-new', 'u-newest')]);
    const byDate = (update: ProjectUpdate) => Date.parse(update.date);
    const automatic = mostRecentProjectHeroPhoto([prior, newest, current], byDate, localUri);
    const cover = resolveProjectCoverImage([{ name: 'Canopy B', coverPhotoMode: 'automatic' }], 'canopy b', automatic);
    expect(cover?.photo.id).toBe('p-new');
    await render(<ProjectPhotoImage {...cover!} />);
    await waitFor(() => expect(sources()).toEqual([signedFor('canopy-b/u-newest/p-new-IMG_p-new.jpg')]));

    // A photo this device holds shows from its file, unsigned; a chosen cover
    // still wins, and shows nothing while its file downloads.
    const own = fieldUpdate('u-own', '2026-10-01', [{ ...cloudOnly('p-own', 'u-own'), uri: `${HERE}own.jpg` }]);
    expect(mostRecentProjectHeroPhoto([newest, own], byDate, localUri)?.localUri).toBe(`${HERE}own.jpg`);
    const chosen = { name: 'Canopy B', coverPhotoMode: 'manual' as const, coverPhoto: { localUri: 'file:///cover.jpg', updatedAt: 't' } };
    expect(resolveProjectCoverImage([chosen], 'Canopy B', automatic)).toEqual({ localUri: 'file:///cover.jpg', photo: {} });
    expect(resolveProjectCoverImage([{ ...chosen, coverPhoto: { updatedAt: 't' } }], 'Canopy B', automatic)).toBeNull();
    expect(signedUrl).toHaveBeenCalledTimes(1);
  });
});
