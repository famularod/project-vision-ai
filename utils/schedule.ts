import type {
  ProjectUpdate,
  ScheduleItem,
  SchedulePriority,
} from '../types';
import {
  daysUntilDate,
  formatDueDate,
  parseDueDate,
} from './date';

function isActionCategory(category: string) {
  return category === 'Open Issue' || category === 'Safety Concern';
}

function isOpenActionPhoto(photo: ProjectUpdate['photos'][number]) {
  return (
    isActionCategory(photo.category) &&
    photo.actionStatus !== 'Closed' &&
    Boolean(
      photo.actionRequired.trim() ||
        photo.actionOwner.trim() ||
        photo.actionDueDate.trim(),
    )
  );
}

export function actionItemsFromUpdates(savedUpdates: ProjectUpdate[]) {
  return savedUpdates.flatMap(update =>
    update.photos
      .filter(isOpenActionPhoto)
      .map(photo => ({
        id: `${update.id}-${photo.id}`,
        projectName: update.projectName,
        locationName: photo.selectedAreaName || update.selectedAreaName || '',
        taskName: photo.actionRequired || photo.caption || photo.category,
        owner: photo.actionOwner,
        finishDate: photo.actionDueDate,
        status: photo.actionStatus,
        dueLabel: photo.actionDueDate
          ? formatDueDate(photo.actionDueDate)
          : 'No due date',
      }))
      .filter(item => item.finishDate && parseDueDate(item.finishDate)),
  );
}

export function schedulePriorityForDate(finishDate: string): SchedulePriority {
  const days = daysUntilDate(finishDate);

  if (days !== null && days <= 7) return 'High';

  return 'Medium';
}

export function sortedScheduleItems(scheduleItems: ScheduleItem[]) {
  return [...scheduleItems].sort((a, b) => {
    const aDays = daysUntilDate(a.finishDate);
    const bDays = daysUntilDate(b.finishDate);

    if (aDays === null && bDays === null) return 0;
    if (aDays === null) return 1;
    if (bDays === null) return -1;

    return aDays - bDays;
  });
}
