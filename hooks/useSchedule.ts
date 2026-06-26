import { useMemo } from 'react';
import type { ProjectUpdate, ScheduleItem } from '../types';
import { daysUntilDate } from '../utils/date';
import {
  actionItemsFromUpdates,
  sortedScheduleItems,
} from '../utils/schedule';

export function useSchedule(
  scheduleItems: ScheduleItem[],
  savedUpdates: ProjectUpdate[],
) {
  return useMemo(() => {
    const sortedItems = sortedScheduleItems(scheduleItems);
    const actionItems = actionItemsFromUpdates(savedUpdates);
    const dueSoon = sortedItems.filter(item => {
      if (item.status === 'Complete') return false;

      const days = daysUntilDate(item.finishDate);

      return days !== null && days >= 0 && days <= 7;
    });
    const overdue = sortedItems.filter(item => {
      if (item.status === 'Complete') return false;

      const days = daysUntilDate(item.finishDate);

      return days !== null && days < 0;
    });

    return {
      sortedItems,
      actionItems,
      dueSoon,
      overdue,
    };
  }, [scheduleItems, savedUpdates]);
}
