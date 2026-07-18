import type { DAVEActionInboxItem } from './DAVEActionInbox';

export type DAVEFollowThroughReviewState = Readonly<{
  fingerprint: string;
  itemId: string;
  firstSeenAt: string;
  reviewedAt: string | null;
  cadenceHours: number;
  lastSeenAt: string;
  active: boolean;
  lastResolvedAt: string | null;
  lastReactivatedAt: string | null;
  reactivationCount: number;
}>;

export type DAVEFollowThroughReminder = Readonly<{
  fingerprint: string;
  item: DAVEActionInboxItem;
  cadenceHours: number;
  reason: string;
  reviewDueAt: string;
  nextReviewAt: string;
}>;

export type DAVEFollowThroughPlan = Readonly<{
  generatedAt: string;
  reminders: DAVEFollowThroughReminder[];
  reviewStates: DAVEFollowThroughReviewState[];
  suppressedCount: number;
  nextReviewAt: string | null;
}>;

export function planDAVEFollowThrough({
  items,
  reviewStates = [],
  now = new Date(),
}: {
  items: readonly DAVEActionInboxItem[];
  reviewStates?: readonly DAVEFollowThroughReviewState[];
  now?: Date;
}): DAVEFollowThroughPlan {
  const priorByFingerprint = new Map(
    reviewStates.map(review => [review.fingerprint, review]),
  );
  const activeFingerprints = new Set<string>();
  const candidates = items
    .filter(item => item.priority !== 'low')
    .map(item => {
      const fingerprint = stateFingerprint(item);
      activeFingerprints.add(fingerprint);
      const prior = priorByFingerprint.get(fingerprint);
      const review = normalizeReviewState(
        prior,
        item.id,
        fingerprint,
        cadenceFor(item),
        now,
      );
      return { reminder: reminderFor(item, review), review };
    });
  const activeReviews = candidates.map(candidate => candidate.review);
  const historicalReviews = reviewStates
    .filter(review => !activeFingerprints.has(review.fingerprint))
    .map(review => deactivateReviewState(review, now));
  const retainedReviews = [...activeReviews, ...historicalReviews].slice(0, 200);
  const reminders = candidates
    .filter(candidate => now.getTime() >= new Date(candidate.reminder.reviewDueAt).getTime())
    .map(candidate => candidate.reminder);
  const nextReviewTime = candidates.reduce<number | null>((earliest, candidate) => {
    const value = new Date(candidate.reminder.nextReviewAt).getTime();
    return earliest === null || value < earliest ? value : earliest;
  }, null);

  return Object.freeze({
    generatedAt: now.toISOString(),
    reminders: Object.freeze(reminders) as unknown as DAVEFollowThroughReminder[],
    reviewStates: Object.freeze(retainedReviews) as unknown as DAVEFollowThroughReviewState[],
    suppressedCount: candidates.length - reminders.length,
    nextReviewAt: nextReviewTime === null ? null : new Date(nextReviewTime).toISOString(),
  });
}

export function reviewedDAVEFollowThroughStates(
  current: readonly DAVEFollowThroughReviewState[],
  fingerprint: string,
  now = new Date(),
  maxEntries = 200,
) {
  return current
    .map(review => review.fingerprint === fingerprint
      ? Object.freeze({ ...review, reviewedAt: now.toISOString() })
      : review)
    .slice(0, maxEntries);
}

export function parseDAVEFollowThroughReviewStates(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => Boolean(
        item &&
        typeof item.fingerprint === 'string' && item.fingerprint.trim() &&
        typeof item.itemId === 'string' && item.itemId.trim() &&
        validDate(item.firstSeenAt) &&
        (item.reviewedAt === null || validDate(item.reviewedAt)),
      ))
      .map((item): DAVEFollowThroughReviewState => Object.freeze({
        fingerprint: item.fingerprint,
        itemId: item.itemId,
        firstSeenAt: item.firstSeenAt,
        reviewedAt: item.reviewedAt,
        cadenceHours: validCadence(item.cadenceHours) ? item.cadenceHours : 24,
        lastSeenAt: validDate(item.lastSeenAt) ? item.lastSeenAt : item.firstSeenAt,
        active: item.active !== false,
        lastResolvedAt: validDate(item.lastResolvedAt) ? item.lastResolvedAt : null,
        lastReactivatedAt: validDate(item.lastReactivatedAt) ? item.lastReactivatedAt : null,
        reactivationCount: Number.isInteger(item.reactivationCount) && item.reactivationCount >= 0
          ? item.reactivationCount
          : 0,
      }))
      .slice(0, 200);
  } catch {
    return [];
  }
}

function normalizeReviewState(
  prior: DAVEFollowThroughReviewState | undefined,
  itemId: string,
  fingerprint: string,
  cadenceHours: number,
  now: Date,
): DAVEFollowThroughReviewState {
  if (prior && validDate(prior.firstSeenAt) && (prior.reviewedAt === null || validDate(prior.reviewedAt))) {
    const reactivated = prior.active === false;
    // Field fix 2026-07-18 (device cpu_resource/diskwrites kills): the plan
    // must be a FIXPOINT — planning again over its own output with the same
    // items must return identical states. Re-stamping lastSeenAt on every
    // call made each pass differ by milliseconds, so the App effect that
    // persists plan.reviewStates looped forever (setState + full JSON disk
    // write per cycle) until iOS terminated the app. lastSeenAt now moves
    // only on creation and on reactivation, which is when the item was
    // genuinely seen anew.
    return Object.freeze({
      ...prior,
      itemId,
      cadenceHours,
      lastSeenAt: reactivated ? now.toISOString() : prior.lastSeenAt,
      active: true,
      lastReactivatedAt: reactivated ? now.toISOString() : prior.lastReactivatedAt,
      reactivationCount: prior.reactivationCount + (reactivated ? 1 : 0),
    });
  }
  return Object.freeze({
    fingerprint,
    itemId,
    firstSeenAt: now.toISOString(),
    reviewedAt: null,
    cadenceHours,
    lastSeenAt: now.toISOString(),
    active: true,
    lastResolvedAt: null,
    lastReactivatedAt: null,
    reactivationCount: 0,
  });
}

function deactivateReviewState(
  review: DAVEFollowThroughReviewState,
  now: Date,
): DAVEFollowThroughReviewState {
  if (!review.active) return Object.freeze({ ...review });
  return Object.freeze({
    ...review,
    active: false,
    lastResolvedAt: now.toISOString(),
  });
}

function reminderFor(
  item: DAVEActionInboxItem,
  review: DAVEFollowThroughReviewState,
): DAVEFollowThroughReminder {
  const cadenceHours = review.cadenceHours;
  const cadenceMs = cadenceHours * 60 * 60 * 1000;
  const baseline = new Date(review.reviewedAt || review.firstSeenAt).getTime();
  const dueAt = new Date(baseline + cadenceMs).toISOString();
  return Object.freeze({
    fingerprint: review.fingerprint,
    item,
    cadenceHours,
    reason: reminderReason(item),
    reviewDueAt: dueAt,
    nextReviewAt: dueAt,
  });
}

function stateFingerprint(item: DAVEActionInboxItem) {
  const state = [
    item.priority,
    item.kind,
    item.requiresVerification ? 'verify' : 'act',
    dueBucket(item.dueDays),
    item.owner || 'unassigned',
    item.summary,
  ].join('|');
  return `dave-follow-through:${item.id}:${stableHash(state)}`;
}

function cadenceFor(item: DAVEActionInboxItem) {
  if (item.priority === 'critical') return 4;
  if (item.requiresVerification) return 12;
  if (item.priority === 'high') return 24;
  return 72;
}

function dueBucket(days: number | null) {
  if (days === null) return 'undated';
  if (days < -7) return 'overdue-7-plus';
  if (days < 0) return `overdue-${Math.abs(days)}`;
  if (days === 0) return 'today';
  if (days <= 7) return `due-${days}`;
  return 'later';
}

function reminderReason(item: DAVEActionInboxItem) {
  if (item.requiresVerification) return 'This stays visible until a person verifies the source-backed claim.';
  if (item.priority === 'critical') return 'This condition remains critical and needs a fresh review.';
  if (item.dueDays !== null && item.dueDays < 0) return 'The accountable date has passed and no resolution is recorded.';
  if (!item.owner) return 'The responsibility is still open without a confirmed owner.';
  if (!item.dueDate) return 'The responsibility is still open without a confirmed due date.';
  return 'The responsibility remains open and has reached its follow-through review window.';
}

function validDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function validCadence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
