import type {
  ProjectUpdate,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  formatDisplayDate,
  parseDueDate,
  parseFlexibleDate,
} from '../utils/date';

export type AIProjectCoachAnalysis = {
  score: number;
  accomplishments: string[];
  risks: string[];
  recommendations: string[];
  summary: string;
};

type AnalyzeProjectCoachParams = {
  projectName: string;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
};

const UPCOMING_SCHEDULE_WINDOW_DAYS = 7;

function isSameProject(projectName: string, nextProjectName: string) {
  return projectName.trim().toLowerCase() === nextProjectName.trim().toLowerCase();
}

function hasUpdateContent(update: ProjectUpdate) {
  return update.photos.length > 0 || update.notes.trim().length > 0;
}

function isActionCategory(photo: UpdatePhoto) {
  return photo.category === 'Open Issue' || photo.category === 'Safety Concern';
}

function hasActionDetails(photo: UpdatePhoto) {
  return Boolean(
    photo.actionRequired.trim() ||
      photo.actionOwner.trim() ||
      photo.actionDueDate.trim(),
  );
}

function isOpenAction(photo: UpdatePhoto) {
  return (
    isActionCategory(photo) &&
    photo.actionStatus !== 'Closed' &&
    hasActionDetails(photo)
  );
}

function daysSinceUpdate(dateValue: string) {
  const date = parseDueDate(dateValue);

  if (!date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.max(0, Math.round((today.getTime() - date.getTime()) / 86400000));
}

function daysUntilScheduleDate(dateValue: string) {
  const date = parseFlexibleDate(dateValue);

  if (!date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function dueSoonLabel(count: number) {
  return `${count} ${count === 1 ? 'schedule item' : 'schedule items'} due within ${UPCOMING_SCHEDULE_WINDOW_DAYS} days`;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function analyzeProjectCoach({
  projectName,
  updates,
  scheduleItems,
  currentUpdate,
}: AnalyzeProjectCoachParams): AIProjectCoachAnalysis {
  const savedProjectUpdates = updates.filter(update =>
    isSameProject(projectName, update.projectName),
  );

  const shouldIncludeCurrentUpdate =
    currentUpdate &&
    isSameProject(projectName, currentUpdate.projectName) &&
    hasUpdateContent(currentUpdate) &&
    !savedProjectUpdates.some(update => update.id === currentUpdate.id);

  const projectUpdates = shouldIncludeCurrentUpdate
    ? [currentUpdate, ...savedProjectUpdates]
    : savedProjectUpdates;
  const savedUpdateCount = savedProjectUpdates.length;

  const projectScheduleItems = scheduleItems.filter(item =>
    isSameProject(projectName, item.projectName),
  );

  const photos = projectUpdates.flatMap(update => update.photos);
  const openActions = photos.filter(isOpenAction);
  const closedActions = photos.filter(
    photo => isActionCategory(photo) && photo.actionStatus === 'Closed',
  );
  const safetyConcerns = photos.filter(
    photo => photo.category === 'Safety Concern',
  );
  const unresolvedSafetyConcerns = safetyConcerns.filter(
    photo => photo.actionStatus !== 'Closed',
  );
  const incompleteDatedScheduleItems: Array<{
    item: ScheduleItem;
    days: number;
  }> = [];

  projectScheduleItems.forEach(item => {
    if (item.status === 'Complete') return;

    const days = daysUntilScheduleDate(item.finishDate);

    if (days !== null) {
      incompleteDatedScheduleItems.push({ item, days });
    }
  });

  const overdueScheduleItems = incompleteDatedScheduleItems
    .filter(({ days }) => days < 0)
    .map(({ item }) => item);
  const upcomingScheduleItems = incompleteDatedScheduleItems.filter(
    ({ days }) => days >= 0 && days <= UPCOMING_SCHEDULE_WINDOW_DAYS,
  );
  const datedScheduleItems = projectScheduleItems.filter(item =>
    Boolean(item.finishDate.trim()),
  );
  const completeScheduleItems = projectScheduleItems.filter(
    item => item.status === 'Complete',
  );
  const progressValues = projectScheduleItems.map(item =>
    clampPercent(item.percentComplete),
  );
  const averageProgress =
    progressValues.length > 0
      ? Math.round(
          progressValues.reduce((total, value) => total + value, 0) /
            progressValues.length,
        )
      : null;
  const latestUpdate = projectUpdates
    .map(update => update.date)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0];
  const daysSinceLastUpdate = latestUpdate ? daysSinceUpdate(latestUpdate) : null;

  let score = 68;
  score += Math.min(savedUpdateCount, 5) * 4;
  score += shouldIncludeCurrentUpdate ? 2 : 0;
  score += photos.length > 0 ? Math.min(photos.length, 8) : -6;
  score += Math.min(closedActions.length, 4) * 2;
  score += Math.min(completeScheduleItems.length, 3) * 2;
  score -= Math.min(openActions.length * 5, 25);
  score -= Math.min(unresolvedSafetyConcerns.length * 8, 32);
  score -= Math.min(overdueScheduleItems.length * 9, 27);
  score -= Math.min(upcomingScheduleItems.length * 3, 12);

  if (averageProgress !== null) {
    if (averageProgress >= 80) {
      score += 8;
    } else if (averageProgress >= 60) {
      score += 5;
    } else if (averageProgress >= 40) {
      score += 2;
    } else {
      score -= 6;
    }
  }

  if (daysSinceLastUpdate === null) {
    score -= 18;
  } else if (daysSinceLastUpdate > 14) {
    score -= 16;
  } else if (daysSinceLastUpdate > 7) {
    score -= 8;
  } else if (daysSinceLastUpdate > 3) {
    score -= 3;
  } else {
    score += 4;
  }

  const finalScore = clampScore(score);

  const accomplishments: string[] = [];
  if (savedUpdateCount > 0) {
    accomplishments.push(
      `${countLabel(savedUpdateCount, 'saved update')} captured for ${projectName}.`,
    );
  }
  if (shouldIncludeCurrentUpdate) {
    accomplishments.push('The current in-progress update has content ready for review.');
  }
  if (photos.length > 0) {
    accomplishments.push(
      `${countLabel(photos.length, 'photo')} available for field context and executive review.`,
    );
  }
  if (closedActions.length > 0) {
    accomplishments.push(
      `${countLabel(closedActions.length, 'action item')} marked closed.`,
    );
  }
  if (completeScheduleItems.length > 0) {
    accomplishments.push(
      `${countLabel(completeScheduleItems.length, 'schedule item')} marked complete.`,
    );
  }
  if (averageProgress !== null) {
    accomplishments.push(
      `Schedule progress averages ${averageProgress}% across ${countLabel(projectScheduleItems.length, 'item')}.`,
    );
  }
  if (datedScheduleItems.length > 0) {
    accomplishments.push(
      `${countLabel(datedScheduleItems.length, 'schedule item')} has a tracked finish or due date.`,
    );
  }
  if (overdueScheduleItems.length === 0 && projectScheduleItems.length > 0) {
    accomplishments.push('No overdue schedule items detected.');
  }
  if (accomplishments.length === 0) {
    accomplishments.push(
      `${projectName} is selected and ready for the first captured update.`,
    );
  }

  const risks: string[] = [];
  if (savedUpdateCount === 0) {
    risks.push('No saved updates are available for this project yet.');
  }
  if (photos.length === 0) {
    risks.push('No project photos are available for field condition review yet.');
  }
  if (openActions.length > 0) {
    risks.push(
      `${countLabel(openActions.length, 'open action item')} still needs follow-up.`,
    );
  }
  if (unresolvedSafetyConcerns.length > 0) {
    risks.push(
      `${countLabel(unresolvedSafetyConcerns.length, 'unresolved safety concern')} appears in project updates.`,
    );
  }
  if (overdueScheduleItems.length > 0) {
    risks.push(
      `${countLabel(overdueScheduleItems.length, 'schedule item')} is overdue.`,
    );
  }
  if (upcomingScheduleItems.length > 0) {
    risks.push(
      `${dueSoonLabel(upcomingScheduleItems.length)} needs near-term attention.`,
    );
  }
  if (projectScheduleItems.length === 0) {
    risks.push('No schedule items are available for schedule risk analysis.');
  } else if (datedScheduleItems.length === 0) {
    risks.push('Schedule items do not have tracked finish or due dates yet.');
  }
  if (averageProgress !== null && averageProgress < 25) {
    risks.push(
      `Average schedule progress is ${averageProgress}%, which may indicate early-stage or delayed work.`,
    );
  }
  if (daysSinceLastUpdate === null) {
    risks.push('No saved or in-progress update content is available for this project yet.');
  } else if (daysSinceLastUpdate > 7) {
    risks.push(
      `Last update was ${countLabel(daysSinceLastUpdate, 'day')} ago.`,
    );
  }
  if (risks.length === 0) {
    risks.push('No overdue items detected. No recent risks identified from the current local data.');
  }

  const recommendations: string[] = [];
  if (openActions.length > 0) {
    recommendations.push('Review open action items, confirm owners, and update due dates before the next status report.');
  }
  if (unresolvedSafetyConcerns.length > 0) {
    recommendations.push('Prioritize safety concerns and confirm whether each item has a documented resolution path.');
  }
  if (overdueScheduleItems.length > 0) {
    recommendations.push('Reconcile overdue schedule items with current field status and revise the timeline where needed.');
  }
  if (upcomingScheduleItems.length > 0) {
    recommendations.push('Confirm readiness for schedule items due within the next 7 days and remove blockers early.');
  }
  if (projectScheduleItems.length === 0) {
    recommendations.push('Add or import schedule items so the coach can evaluate due dates and progress.');
  } else if (averageProgress !== null && averageProgress < 50) {
    recommendations.push('Review schedule progress and update percent complete for active work packages.');
  }
  if (photos.length === 0) {
    recommendations.push('Capture field photos with captions so the next analysis has visual evidence.');
  }
  if (daysSinceLastUpdate === null || daysSinceLastUpdate > 7) {
    recommendations.push('Capture a fresh project update with current photos, notes, and decisions needed.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Continue the current update cadence and keep capturing photos when field conditions change.');
  }

  const lastUpdateText = latestUpdate
    ? ` Last update: ${formatDisplayDate(latestUpdate)}.`
    : ' No update date is available yet.';
  const progressText =
    averageProgress === null
      ? 'no schedule progress data'
      : `${averageProgress}% average schedule progress`;

  const summary =
    `${projectName} has a health score of ${finalScore}/100 based on ` +
    `${countLabel(savedUpdateCount, 'saved update')}, ` +
    `${countLabel(photos.length, 'photo')}, ` +
    `${countLabel(openActions.length, 'open action item')}, ` +
    `${countLabel(unresolvedSafetyConcerns.length, 'unresolved safety concern')}, ` +
    `${countLabel(overdueScheduleItems.length, 'overdue schedule item')}, ` +
    `${dueSoonLabel(upcomingScheduleItems.length)}, and ` +
    `${progressText}.` +
    lastUpdateText;

  return {
    score: finalScore,
    accomplishments,
    risks,
    recommendations,
    summary,
  };
}
