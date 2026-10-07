/**
 * Review pass 1, L8 (wording; caused by "an unfinished update resumed after
 * the app was closed still says why it has no GPS"). A resumed update showed
 * the reason kept for it in the present tense: "Location permission denied."
 * and "Precise Location is off." After the setting had been put right in iOS
 * Settings the resumed update still said so. It was true of when the update
 * was started, not of now.
 *
 * The reason is kept (a resumed update is never given a new fix, so it is
 * still why this update has no GPS), and a resumed update now says it of
 * when the update was started, which stays true whatever the setting is now.
 */
import {
  currentDraftLocationNoticeView,
  draftAreaPresentation,
  draftLocationNoticeText,
  PRECISE_LOCATION_OFF_DRAFT_MESSAGE,
} from '../../services/DraftAreaPresentation';
import {
  draftLocationNoticeToKeep,
  resumedDraftLocationNotice,
} from '../../services/DraftLocationNoticeStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const noGps = { id: 'draft-1', gpsLatitude: null, gpsLongitude: null };

/** What Add Photos shows under the Current Area card for a notice. */
const shownFor = (notice: ReturnType<typeof resumedDraftLocationNotice>) => draftAreaPresentation({
  selectedArea: null,
  selectedAreaName: 'Unassigned / Unknown Area',
  areaStatus: 'unknown',
  areaSuggestion: null,
  hasScheduleRecommendation: false,
  locationNotice: currentDraftLocationNoticeView({ notice, generation: 0, draft: noGps, areas: [] }),
}).locationNotice;

const resumed = (kind: 'denied' | 'failed' | 'precise-off') =>
  resumedDraftLocationNotice({ kept: { draftId: 'draft-1', kind }, draft: noGps, generation: 0 });

describe('L8: what a resumed update says about its GPS', () => {
  it('location not allowed: it says so of when the update was started (was: "Location permission denied.", as if now)', () => {
    expect(shownFor(resumed('denied')))
      .toBe('Location was not allowed when this update was started, so it has no GPS. Choose Project Area manually.');
  });

  it('Precise Location off: it says so of when the update was started (was: "Precise Location is off.", as if now)', () => {
    expect(shownFor(resumed('precise-off'))).toBe(
      'Precise Location was off when this update was started. Vitruvius only got an approximate location, ' +
      'which cannot place you in a work area, so this update has no GPS. ' +
      'If it is still off, turn on Precise Location for Vitruvius in Settings; your next update will use it.',
    );
  });

  it('neither sentence says how the setting stands now', () => {
    for (const kind of ['denied', 'precise-off'] as const) {
      const sentence = shownFor(resumed(kind)) as string;
      expect(sentence).toContain('when this update was started');
      expect(sentence).not.toMatch(/permission denied|Location is off/);
    }
  });

  it('no fix could be taken: already said of what happened, and unchanged', () => {
    expect(shownFor(resumed('failed'))).toBe('GPS could not be captured. Choose Project Area manually.');
  });

  it('the notice a resumed update is given is marked as one kept from before', () => {
    expect(resumed('denied')).toEqual({ draftId: 'draft-1', generation: 0, kind: 'denied', resumed: true });
  });

  it('what is kept on the phone is the same two things as before: the update\'s id and one word', () => {
    expect(draftLocationNoticeToKeep(resumed('denied'))).toEqual({ draftId: 'draft-1', kind: 'denied' });
    expect(draftLocationNoticeToKeep(resumed('precise-off'))).toEqual({ draftId: 'draft-1', kind: 'precise-off' });
  });
});

// Guards: these already hold.
describe('L8 guards: an update just started says it as it is, as before', () => {
  it.each([
    ['denied', 'Location permission denied. Choose Project Area manually.'],
    ['failed', 'GPS could not be captured. Choose Project Area manually.'],
    ['precise-off', PRECISE_LOCATION_OFF_DRAFT_MESSAGE],
    ['capturing', 'Capturing GPS...'],
  ] as const)('%s', (kind, sentence) => {
    expect(draftLocationNoticeText({ kind })).toBe(sentence);
    expect(shownFor({ draftId: 'draft-1', generation: 0, kind })).toBe(sentence);
  });

  it('the Precise Location sentence for an update just started still begins "Precise Location is off."', () => {
    expect(PRECISE_LOCATION_OFF_DRAFT_MESSAGE.startsWith('Precise Location is off. Vitruvius only gets an approximate location')).toBe(true);
  });
});
