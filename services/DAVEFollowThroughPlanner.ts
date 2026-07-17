import type { DAVEActionInboxItem } from './DAVEActionInbox';

export type DAVEFollowThroughReviewState = Readonly<{
  fingerprint: string;
  itemId: string;
  firstSeenAt: string;
  reviewedAt: string | null;
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
  const candidates = items
    .filter(item => item.priority !== 'low')
    .map(item => {
      const fingerprint = stateFingerprint(item);
      const prior = priorByFingerprint.get(fingerprint);
      const review = normalizeReviewState(prior, item.id, fingerprint, now);
      return { reminder: reminderFor(item, review), review };
    });
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
    reviewStates: Object.freeze(candidates.map(candidate => candidate.review)) as unknown as DAVEFollowThroughReviewState[],
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
      .filter((item): item is DAVEFollowThroughReviewState => Boolean(
        item &&
        typeof item.fingerprint === 'string' && item.fingerprint.trim() &&
        typeof item.itemId === 'string' && item.itemId.trim() &&
        validDate(item.firstSeenAt) &&
        (item.reviewedAt === null || validDate(item.reviewedAt)),
      ))
      .slice(0, 200);
  } catch {
    return [];
  }
}

function normalizeReviewState(
  prior: DAVEFollowThroughReviewState | undefined,
  itemId: string,
  fingerprint: string,
  now: Date,
): DAVEFollowThroughReviewState {
  if (prior && validDate(prior.firstSeenAt) && (prior.reviewedAt === null || validDate(prior.reviewedAt))) {
    return Object.freeze({ ...prior });
  }
  return Object.freeze({
    fingerprint,
    itemId,
    firstSeenAt: now.toISOString(),
    reviewedAt: null,
  });
}

function reminderFor(
  item: DAVEActionInboxItem,
  review: DAVEFollowThroughReviewState,
): DAVEFollowThroughReminder {
  const cadenceHours = cadenceFor(item);
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

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
