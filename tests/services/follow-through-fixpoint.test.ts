/**
 * Device-crash regression (2026-07-18): planDAVEFollowThrough must be a
 * FIXPOINT. The app persists plan.reviewStates and feeds them back as the
 * next input; if replanning over its own output ever differs, the effect
 * loops forever (cpu_resource + diskwrites kills on device).
 */

import { planDAVEFollowThrough } from '../../services/DAVEFollowThroughPlanner';
import type { DAVEActionInboxItem } from '../../services/DAVEActionInbox';

function item(id: string, priority: DAVEActionInboxItem['priority']): DAVEActionInboxItem {
  return {
    id,
    kind: 'schedule',
    priority,
    summary: `Open responsibility ${id}`,
    owner: null,
    dueDate: '2026-07-10',
    dueDays: -8,
    requiresVerification: false,
    scheduleItemId: id,
  } as unknown as DAVEActionInboxItem;
}

describe('planDAVEFollowThrough fixpoint (device loop regression)', () => {
  const items = [item('a', 'high'), item('b', 'critical'), item('c', 'medium')];

  it('replanning over its own output with the same items is identical', () => {
    const t1 = new Date('2026-07-18T12:00:00Z');
    const first = planDAVEFollowThrough({ items, reviewStates: [], now: t1 });

    // Later wall-clock times must NOT change the states when nothing happened.
    const t2 = new Date('2026-07-18T12:00:00.250Z');
    const second = planDAVEFollowThrough({
      items,
      reviewStates: first.reviewStates,
      now: t2,
    });

    expect(JSON.stringify(second.reviewStates)).toBe(JSON.stringify(first.reviewStates));

    const t3 = new Date('2026-07-18T12:05:00Z');
    const third = planDAVEFollowThrough({
      items,
      reviewStates: second.reviewStates,
      now: t3,
    });
    expect(JSON.stringify(third.reviewStates)).toBe(JSON.stringify(second.reviewStates));
  });

  it('still stamps lastSeenAt on genuine reactivation', () => {
    const t1 = new Date('2026-07-18T12:00:00Z');
    const first = planDAVEFollowThrough({ items, reviewStates: [], now: t1 });

    // Item disappears -> deactivated.
    const t2 = new Date('2026-07-18T13:00:00Z');
    const without = planDAVEFollowThrough({
      items: items.slice(1),
      reviewStates: first.reviewStates,
      now: t2,
    });
    const deactivated = without.reviewStates.find(state => state.itemId === 'a');
    expect(deactivated?.active).toBe(false);

    // Item returns -> reactivated with fresh lastSeenAt and counted.
    const t3 = new Date('2026-07-18T14:00:00Z');
    const returned = planDAVEFollowThrough({
      items,
      reviewStates: without.reviewStates,
      now: t3,
    });
    const reactivated = returned.reviewStates.find(state => state.itemId === 'a');
    expect(reactivated?.active).toBe(true);
    expect(reactivated?.lastSeenAt).toBe(t3.toISOString());
    expect(reactivated?.reactivationCount).toBe(1);

    // And the reactivated state is itself a fixpoint afterward.
    const t4 = new Date('2026-07-18T14:00:01Z');
    const again = planDAVEFollowThrough({
      items,
      reviewStates: returned.reviewStates,
      now: t4,
    });
    expect(JSON.stringify(again.reviewStates)).toBe(JSON.stringify(returned.reviewStates));
  });
});
