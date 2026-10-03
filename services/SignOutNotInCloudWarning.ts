/**
 * The Sign Out warning's sentences about items not in the cloud yet (whole-app
 * audit A11 pass 7 L1, 30 Sep 2026). `notInCloudCount` counts every item only
 * on this phone, including field notes marked "Review needed"
 * (`needingReviewCount`). Those stay on the phone too, but they do not sync
 * after sign-in on their own: they wait for Keep my version or Use cloud
 * version in Field Notes. So "syncs after you sign in" is said only of the
 * others, with the verb matching the count ("1 stays ... and syncs").
 */
export function signOutNotInCloudSentences(notInCloudCount: number, needingReviewCount: number): string {
  const total = Math.max(0, notInCloudCount);
  const review = Math.min(Math.max(0, needingReviewCount), total);
  const others = total - review;
  const one = total === 1;
  const head = `${total} item${one ? ' is' : 's are'} not in the cloud yet`;
  if (review === 0) {
    return `${head}. ${one ? 'It stays' : 'They stay'} on this phone and ${one ? 'syncs' : 'sync'} after you sign in here again with this account.`;
  }
  if (others === 0) {
    return one
      ? `${head}: a field note marked Review needed. It stays on this phone and waits for your choice in Field Notes.`
      : `${head}: field notes marked Review needed. They stay on this phone and wait for your choice in Field Notes.`;
  }
  return `${head}. ${others} ${others === 1 ? 'stays' : 'stay'} on this phone and ${others === 1 ? 'syncs' : 'sync'} after you sign in here again with this account. Field notes marked Review needed wait for your choice in Field Notes.`;
}
