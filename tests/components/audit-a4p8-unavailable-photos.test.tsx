/**
 * Whole-app audit A4 pass 8 F4 (30 Sep 2026): a photo the sync marked
 * 'unavailable' (no file on the phone and none in the cloud, so nothing was
 * uploaded) still carries a storage path worked out from its update. The
 * automatic project cover took it ahead of a later photo of the same update
 * that does exist, so the cover was a blank image where it used to be the
 * placeholder; comparisons and the Before/After row showed it blank too.
 * Renders the real cover choice, comparison builder, Before/After row and
 * image with SyncService signing; only the Supabase signing call is mocked.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import {
  PhotoComparisonPreviewRow,
  SavedFieldUpdatesContext,
} from '../../components/photo-comparison-preview-row';
import { ProjectPhotoImage } from '../../components/ProjectPhotoImage';
import { updatePhotoComparisonViewModel } from '../../components/updates-workspace-layout';
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
const localUri = (photo: Partial<UpdatePhoto>) => (photo.uri?.startsWith(HERE) ? photo.uri : '');
/** Paths with nothing behind them: the storage answers "not found". */
const gone = new Set<string>();

beforeEach(() => {
  gone.clear();
  signedUrl.mockReset().mockImplementation(async (path: string) => (gone.has(path)
    ? { ok: false, stubbed: false, data: null, error: 'Object not found', status: 400 }
    : { ok: true, stubbed: false, data: signedFor(path) }));
});

const cloudOnly = (id: string, updateId: string, extra: Partial<UpdatePhoto> = {}): UpdatePhoto => ({
  id, uri: '', caption: '', category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '',
  actionStatus: 'Open', fileName: `IMG_${id}.jpg`, mimeType: 'image/jpeg',
  cloudStoragePath: `canopy-b/${updateId}/${id}-IMG_${id}.jpg`, ...extra,
} as UpdatePhoto);
/** Marked by the sync: its file was gone before it uploaded; the path is the one worked out from the update. */
const unavailable = (id: string, updateId: string, extra: Partial<UpdatePhoto> = {}): UpdatePhoto => {
  const photo = cloudOnly(id, updateId, { cloudRecoveryStatus: 'unavailable', ...extra });
  gone.add(photo.cloudStoragePath!);
  return photo;
};
const fieldUpdate = (id: string, date: string, photos: UpdatePhoto[]) =>
  ({ id, projectName: 'Canopy B', date, recipients: { contactIds: [] }, status: 'sent', photos } as unknown as ProjectUpdate);
const analysed = (priorPhotoId: string, summary = 'Panels now cover the east elevation.') => ({
  status: 'analysis_complete', title: 'Visible change', summary, changedFromPrior: summary,
  userReview: null, priorPhotoUri: '', diagnostics: { selectedPriorPhotoId: priorPhotoId },
}) as unknown as NonNullable<UpdatePhoto['photoIntelligence']>;
const byDate = (update: ProjectUpdate) => Date.parse(update.date);
const sources = () => screen.UNSAFE_getAllByType(ProjectPhotoImage)
  .map(image => image.findByType(require('react-native').Image).props.source.uri);

describe("a photo marked 'unavailable' (A4 pass 8 F4)", () => {
  it('the automatic cover passes over it for the next photo of the same update, and never signs it', async () => {
    const newest = fieldUpdate('u-newest', '2026-09-30', [unavailable('p-lost', 'u-newest'), cloudOnly('p-ok', 'u-newest')]);
    const older = fieldUpdate('u-older', '2026-09-20', [cloudOnly('p-old', 'u-older')]);
    const automatic = mostRecentProjectHeroPhoto([older, newest], byDate, localUri);
    const cover = resolveProjectCoverImage([{ name: 'Canopy B', coverPhotoMode: 'automatic' }], 'Canopy B', automatic);
    expect(cover?.photo.id).toBe('p-ok');
    await render(<ProjectPhotoImage {...cover!} />);
    await waitFor(() => expect(sources()).toEqual([signedFor('canopy-b/u-newest/p-ok-IMG_p-ok.jpg')]));
    expect(signedUrl).toHaveBeenCalledTimes(1);

    // An update whose only photo is gone gives way to the older update; one
    // this device still holds the file for is shown from it.
    const onlyLost = fieldUpdate('u-lost', '2026-10-01', [unavailable('p-lost2', 'u-lost')]);
    expect(mostRecentProjectHeroPhoto([older, onlyLost], byDate, localUri)?.photo.id).toBe('p-old');
    const held = fieldUpdate('u-held', '2026-10-02', [unavailable('p-held', 'u-held', { uri: `${HERE}held.jpg` })]);
    expect(mostRecentProjectHeroPhoto([older, held], byDate, localUri)?.localUri).toBe(`${HERE}held.jpg`);
    expect(mostRecentProjectHeroPhoto([onlyLost], byDate, localUri)).toBeNull();
  });

  it('the Updates comparison passes over a pair with a missing photo for the next pair whose photos exist', async () => {
    const prior = fieldUpdate('u-prior', '2026-09-20', [unavailable('p-prior-lost', 'u-prior'), cloudOnly('p-prior-ok', 'u-prior')]);
    const current = fieldUpdate('u-now', '2026-09-29', [
      cloudOnly('p-now-1', 'u-now', { photoIntelligence: analysed('p-prior-lost', 'Against the missing photo.') }),
      cloudOnly('p-now-2', 'u-now', { photoIntelligence: analysed('p-prior-ok') }),
    ]);
    const comparison = updatePhotoComparisonViewModel(
      buildDAVEUpdatePhotoComparison(current, [prior, current]), date => date, localUri);
    expect(comparison?.priorPhoto?.id).toBe('p-prior-ok');
    expect(comparison?.currentPhoto?.id).toBe('p-now-2');
    expect(comparison?.summary).toBe('Panels now cover the east elevation.');

    // The current photo missing counts the same; with no other pair, none.
    const lostNow = fieldUpdate('u-lost-now', '2026-09-30', [
      unavailable('p-now-lost', 'u-lost-now', { photoIntelligence: analysed('p-prior-ok') }),
    ]);
    expect(buildDAVEUpdatePhotoComparison(lostNow, [prior, lostNow])).toBeNull();
    const onlyLostPrior = fieldUpdate('u-only', '2026-09-30', [
      cloudOnly('p-only', 'u-only', { photoIntelligence: analysed('p-prior-lost') }),
    ]);
    expect(buildDAVEUpdatePhotoComparison(onlyLostPrior, [prior, onlyLostPrior])).toBeNull();
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('the Before/After row stays hidden when either photo is missing, and nothing is signed', async () => {
    const lostPrior = fieldUpdate('u-lost', '2026-09-20', [unavailable('p-prior-lost', 'u-lost')]);
    const photo = cloudOnly('p-now', 'u-now');
    const { rerender } = await render(
      <SavedFieldUpdatesContext.Provider value={[lostPrior]}>
        <PhotoComparisonPreviewRow result={analysed('p-prior-lost')} photo={photo} projectName="Canopy B" localUri={localUri} />
      </SavedFieldUpdatesContext.Provider>,
    );
    expect(screen.queryByTestId('photo-comparison-preview-row')).toBeNull();

    const shownPrior = fieldUpdate('u-prior', '2026-09-20', [cloudOnly('p-prior', 'u-prior')]);
    const lostNow = unavailable('p-now-lost', 'u-now');
    await rerender(
      <SavedFieldUpdatesContext.Provider value={[shownPrior]}>
        <PhotoComparisonPreviewRow result={analysed('p-prior')} photo={lostNow} projectName="Canopy B" localUri={localUri} />
      </SavedFieldUpdatesContext.Provider>,
    );
    expect(screen.queryByTestId('photo-comparison-preview-row')).toBeNull();

    // Both there: the row shows, as before.
    await rerender(
      <SavedFieldUpdatesContext.Provider value={[shownPrior]}>
        <PhotoComparisonPreviewRow result={analysed('p-prior')} photo={photo} projectName="Canopy B" localUri={localUri} />
      </SavedFieldUpdatesContext.Provider>,
    );
    await waitFor(() => expect(sources()).toEqual([
      signedFor('canopy-b/u-prior/p-prior-IMG_p-prior.jpg'),
      signedFor('canopy-b/u-now/p-now-IMG_p-now.jpg'),
    ]));
    expect(signedUrl).toHaveBeenCalledTimes(2);
  });
});
