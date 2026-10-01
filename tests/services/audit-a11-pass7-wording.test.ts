import { signOutNotInCloudSentences } from '../../services/SignOutNotInCloudWarning';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');

// Whole-app audit A11 pass 7 (30 Sep 2026): wording that said more than is
// true. Synthetic counts only.

describe('A11 pass 7 L1: the Sign Out sentence about items not in the cloud', () => {
  const AFTER_SIGN_IN = 'after you sign in here again with this account.';
  const REVIEW = 'Field notes marked Review needed wait for your choice in Field Notes.';

  it.each([
    [1, 0, `1 item is not in the cloud yet. It stays on this phone and syncs ${AFTER_SIGN_IN}`],
    [2, 0, `2 items are not in the cloud yet. They stay on this phone and sync ${AFTER_SIGN_IN}`],
    // Only the items that are not Review needed field notes sync after sign-in.
    [2, 1, `2 items are not in the cloud yet. 1 stays on this phone and syncs ${AFTER_SIGN_IN} ${REVIEW}`],
    [5, 2, `5 items are not in the cloud yet. 3 stay on this phone and sync ${AFTER_SIGN_IN} ${REVIEW}`],
    [3, 1, `3 items are not in the cloud yet. 2 stay on this phone and sync ${AFTER_SIGN_IN} ${REVIEW}`],
    // Every item is a Review needed field note: none syncs on its own.
    [1, 1, '1 item is not in the cloud yet: a field note marked Review needed. It stays on this phone and waits for your choice in Field Notes.'],
    [2, 2, '2 items are not in the cloud yet: field notes marked Review needed. They stay on this phone and wait for your choice in Field Notes.'],
  ])('%i item(s), %i needing review', (notInCloud, needingReview, sentence) => {
    expect(signOutNotInCloudSentences(notInCloud, needingReview)).toBe(sentence);
  });

  it('never says "It ... sync" or counts more needing review than there are items', () => {
    expect(signOutNotInCloudSentences(1, 0)).not.toMatch(/\bIt stays on this phone and sync\b/);
    expect(signOutNotInCloudSentences(1, 3)).toBe(signOutNotInCloudSentences(1, 1));
  });

  it('AdminScreen uses it for the Sign Out warning', () => {
    const admin = read('screens/AdminScreen.tsx');
    expect(admin).toContain('${signOutNotInCloudSentences(notInCloudCount, fieldNotesForReview)} Sign out anyway?');
    expect(admin).not.toContain("'It stays' : 'They stay'} on this phone and sync after");
  });

  it('the field note counts each sit under their own comment', () => {
    const source = read('services/FieldNotesWaitingToSync.ts');
    const waiting = source.indexOf('export async function fieldNotesWaitingToSync');
    const review = source.indexOf('export async function fieldNotesNeedingReview');
    const waitingDoc = source.lastIndexOf('/**', waiting);
    const reviewDoc = source.lastIndexOf('/**', review);
    expect(source.slice(waitingDoc, waiting)).toContain('still waiting to sync');
    expect(source.slice(reviewDoc, review)).toContain('Review needed');
    expect(source.slice(reviewDoc, review)).not.toContain('still waiting to sync');
  });
});

describe('A11 pass 7 L2: a recording kept on the voice sheet is kept only while Vitruvius stays open', () => {
  const sheet = read('components/DAVEVoiceCaptureSheet.tsx');

  it('the project-changed notice and the Stop preparing alert say so', () => {
    expect(sheet).toContain('The project changed while this recording was being prepared. It is kept here while Vitruvius stays open. Tap ${continueLabel} to try again.');
    expect(sheet).toContain('You can keep waiting, keep the recording here while Vitruvius stays open and try ${continueLabel} again later, or discard it.');
    expect(sheet).not.toContain('It is kept here. Tap');
    expect(sheet).not.toContain('keep the recording here to try');
  });
});
