import type { ScheduleItem } from '../types';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';

export type VitruviusReviewQueue = Readonly<{
  items: readonly ScheduleItem[];
  pending: number;
  changesRequested: number;
}>;

/**
 * Builds the signed-in person's approval queue from shared task controls.
 * Matching is exact after normalizing case and whitespace.
 */
export function buildVitruviusReviewQueue({
  items,
  displayName,
  email,
}: {
  items: readonly ScheduleItem[];
  displayName?: string | null;
  email?: string | null;
}): VitruviusReviewQueue {
  const aliases = new Set(
    [displayName, email].map(normalizeIdentity).filter(Boolean),
  );
  const reviewItems = items
    .filter(item => {
      if (item.isSummary === true || scheduleProgressIsComplete(item)) return false;
      const controls = item.projectControls;
      if (
        controls?.approvalStatus !== 'Pending' &&
        controls?.approvalStatus !== 'Changes Requested'
      ) return false;
      return (controls.approvers || []).some(approver =>
        aliases.has(normalizeIdentity(approver)),
      );
    })
    .sort((left, right) => {
      const approvalOrder =
        Number(left.projectControls?.approvalStatus !== 'Changes Requested') -
        Number(right.projectControls?.approvalStatus !== 'Changes Requested');
      return approvalOrder ||
        (left.finishDate || '9999-12-31').localeCompare(right.finishDate || '9999-12-31') ||
        left.taskName.localeCompare(right.taskName);
    });

  return Object.freeze({
    items: Object.freeze(reviewItems),
    pending: reviewItems.filter(item => item.projectControls?.approvalStatus === 'Pending').length,
    changesRequested: reviewItems.filter(
      item => item.projectControls?.approvalStatus === 'Changes Requested',
    ).length,
  });
}

function normalizeIdentity(value: unknown) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').normalize('NFKC').toLocaleLowerCase('en-US')
    : '';
}
