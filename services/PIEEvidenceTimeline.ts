import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEEvidenceTimelineEventType =
  | 'photo_added'
  | 'note_added'
  | 'schedule_imported'
  | 'schedule_changed'
  | 'GPS_confirmed'
  | 'user_corrected'
  | 'issue_opened'
  | 'issue_resolved'
  | 'decision_needed'
  | 'decision_made'
  | 'report_generated'
  | 'report_approved'
  | 'inspection_updated';

export type PIEEvidenceTimelineMomentum =
  | 'progress_increasing'
  | 'progress_slowing'
  | 'no_recent_evidence'
  | 'repeated_same_issue'
  | 'area_going_stale'
  | 'new_activity_after_delay'
  | 'stable';

export type PIEEvidenceTimelineEvent = {
  id: string;
  type: PIEEvidenceTimelineEventType;
  occurredAt: string;
  projectName: string | null;
  areaName: string | null;
  workPackage: string | null;
  issueId: string | null;
  scheduleItemId: string | null;
  decisionId: string | null;
  summary: string;
  source: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEEvidenceTimelineChange = {
  id: string;
  summary: string;
  fromEventId: string | null;
  toEventId: string;
  projectName: string | null;
  areaName: string | null;
  changedAt: string;
  changeType: 'new_activity' | 'progress' | 'risk' | 'decision' | 'resolution' | 'correction';
  confidence: ProjectConfidenceLevel;
};

export type PIEEvidenceTimelineGap = {
  id: string;
  projectName: string | null;
  areaName: string | null;
  summary: string;
  daysSinceEvidence: number | null;
  severity: 'low' | 'medium' | 'high';
  recommendedEvidence: string;
};

export type PIEEvidenceTimelineSummary = {
  summary: string;
  firstEventAt: string | null;
  latestEventAt: string | null;
  eventCount: number;
  recentChangeCount: number;
  staleAreaCount: number;
  momentum: PIEEvidenceTimelineMomentum;
  confidence: ProjectConfidenceLevel;
};

export type PIEEvidenceTimeline = {
  generatedAt: string;
  events: PIEEvidenceTimelineEvent[];
  changes: PIEEvidenceTimelineChange[];
  gaps: PIEEvidenceTimelineGap[];
  staleAreas: PIEEvidenceTimelineGap[];
  momentumSignals: PIEEvidenceTimelineMomentum[];
  recentChanges: PIEEvidenceTimelineChange[];
  byProject: Record<string, PIEEvidenceTimelineEvent[]>;
  byArea: Record<string, PIEEvidenceTimelineEvent[]>;
  summary: PIEEvidenceTimelineSummary;
};

export type PIEEvidenceTimelineInput = {
  events: PIEEvidenceTimelineEvent[];
  staleAfterDays?: number;
  recentWindowDays?: number;
};

export function buildEvidenceTimeline(
  input: PIEEvidenceTimelineInput,
  generatedAt: string = new Date().toISOString(),
): PIEEvidenceTimeline {
  const events = [...input.events]
    .filter(event => Boolean(event.occurredAt))
    .sort((left, right) => timestamp(left.occurredAt) - timestamp(right.occurredAt));
  const gaps = detectTimelineGaps(events, generatedAt, input.staleAfterDays);
  const staleAreas = detectStaleEvidence(events, generatedAt, input.staleAfterDays);
  const momentumSignals = detectProgressMomentum(events, generatedAt, input.recentWindowDays);
  const changes = summarizeTimelineChanges(events);
  const recentChanges = changes.filter(change =>
    daysBetween(change.changedAt, generatedAt) <= (input.recentWindowDays ?? 14),
  );

  return {
    generatedAt,
    events,
    changes,
    gaps,
    staleAreas,
    momentumSignals,
    recentChanges,
    byProject: groupTimelineByProject(events),
    byArea: groupTimelineByArea(events),
    summary: summarizeTimeline(events, recentChanges, staleAreas, momentumSignals),
  };
}

export function groupTimelineByProject(
  events: PIEEvidenceTimelineEvent[],
): Record<string, PIEEvidenceTimelineEvent[]> {
  return groupBy(events, event => event.projectName || 'Unassigned project');
}

export function groupTimelineByArea(
  events: PIEEvidenceTimelineEvent[],
): Record<string, PIEEvidenceTimelineEvent[]> {
  return groupBy(events, event => event.areaName || 'Unassigned area');
}

export function detectTimelineGaps(
  events: PIEEvidenceTimelineEvent[],
  generatedAt: string = new Date().toISOString(),
  staleAfterDays = 21,
): PIEEvidenceTimelineGap[] {
  return Object.entries(groupTimelineByArea(events))
    .map(([areaName, areaEvents]) => {
      const latest = latestEvent(areaEvents);
      const daysSinceEvidence = latest ? daysBetween(latest.occurredAt, generatedAt) : null;
      if (daysSinceEvidence !== null && daysSinceEvidence <= staleAfterDays) return null;

      const gap: PIEEvidenceTimelineGap = {
        id: `timeline-gap-${normalizeId(areaName)}`,
        projectName: latest?.projectName || null,
        areaName,
        summary: latest
          ? `${areaName} has no recent evidence. Last update was ${daysSinceEvidence} days ago.`
          : `${areaName} has no timeline evidence.`,
        daysSinceEvidence,
        severity:
          daysSinceEvidence === null || daysSinceEvidence > staleAfterDays * 2
            ? 'high'
            : 'medium',
        recommendedEvidence: `Capture a current photo or note for ${areaName}.`,
      };

      return gap;
    })
    .filter((gap): gap is PIEEvidenceTimelineGap => Boolean(gap));
}

export function detectStaleEvidence(
  events: PIEEvidenceTimelineEvent[],
  generatedAt: string = new Date().toISOString(),
  staleAfterDays = 21,
): PIEEvidenceTimelineGap[] {
  return detectTimelineGaps(events, generatedAt, staleAfterDays).filter(gap =>
    gap.daysSinceEvidence === null || gap.daysSinceEvidence > staleAfterDays,
  );
}

export function detectProgressMomentum(
  events: PIEEvidenceTimelineEvent[],
  generatedAt: string = new Date().toISOString(),
  recentWindowDays = 14,
): PIEEvidenceTimelineMomentum[] {
  if (events.length === 0) return ['no_recent_evidence'];

  const recent = events.filter(event => daysBetween(event.occurredAt, generatedAt) <= recentWindowDays);
  const prior = events.filter(event => {
    const age = daysBetween(event.occurredAt, generatedAt);
    return age > recentWindowDays && age <= recentWindowDays * 2;
  });
  const signals = new Set<PIEEvidenceTimelineMomentum>();

  if (recent.length === 0) signals.add('no_recent_evidence');
  if (recent.length > prior.length && recent.length > 0) signals.add('progress_increasing');
  if (recent.length < prior.length && prior.length > 0) signals.add('progress_slowing');
  if (recent.length > 0 && prior.length === 0 && events.length > recent.length) {
    signals.add('new_activity_after_delay');
  }
  if (hasRepeatedIssue(events)) signals.add('repeated_same_issue');
  if (detectStaleEvidence(events, generatedAt).length > 0) signals.add('area_going_stale');

  if (signals.size === 0) signals.add('stable');
  return Array.from(signals);
}

export function summarizeTimelineChanges(
  events: PIEEvidenceTimelineEvent[],
): PIEEvidenceTimelineChange[] {
  return events.map((event, index) => {
    const previous = index > 0 ? events[index - 1] : null;
    return {
      id: `timeline-change-${event.id}`,
      summary: changeSummary(event, previous),
      fromEventId: previous?.id || null,
      toEventId: event.id,
      projectName: event.projectName,
      areaName: event.areaName,
      changedAt: event.occurredAt,
      changeType: changeTypeForEvent(event),
      confidence: event.confidence,
    };
  });
}

export function compareTimelinePeriods(
  events: PIEEvidenceTimelineEvent[],
  periodStart: string,
  periodEnd: string,
  comparisonStart: string,
  comparisonEnd: string,
): {
  currentCount: number;
  comparisonCount: number;
  momentum: PIEEvidenceTimelineMomentum;
  summary: string;
} {
  const currentCount = events.filter(event =>
    timestamp(event.occurredAt) >= timestamp(periodStart) &&
    timestamp(event.occurredAt) <= timestamp(periodEnd),
  ).length;
  const comparisonCount = events.filter(event =>
    timestamp(event.occurredAt) >= timestamp(comparisonStart) &&
    timestamp(event.occurredAt) <= timestamp(comparisonEnd),
  ).length;
  const momentum: PIEEvidenceTimelineMomentum =
    currentCount > comparisonCount
      ? 'progress_increasing'
      : currentCount < comparisonCount
        ? 'progress_slowing'
        : currentCount === 0
          ? 'no_recent_evidence'
          : 'stable';

  return {
    currentCount,
    comparisonCount,
    momentum,
    summary: `Current period has ${currentCount} evidence event${currentCount === 1 ? '' : 's'} compared with ${comparisonCount} in the prior period.`,
  };
}

function summarizeTimeline(
  events: PIEEvidenceTimelineEvent[],
  recentChanges: PIEEvidenceTimelineChange[],
  staleAreas: PIEEvidenceTimelineGap[],
  momentumSignals: PIEEvidenceTimelineMomentum[],
): PIEEvidenceTimelineSummary {
  const first = events[0] || null;
  const latest = events[events.length - 1] || null;
  const primaryMomentum = momentumSignals[0] || 'stable';

  return {
    summary: events.length === 0
      ? 'No evidence timeline is available yet.'
      : `${events.length} evidence timeline event${events.length === 1 ? '' : 's'} tracked. ${recentChanges.length} recent change${recentChanges.length === 1 ? '' : 's'} found. ${staleAreas.length} stale area${staleAreas.length === 1 ? '' : 's'} detected.`,
    firstEventAt: first?.occurredAt || null,
    latestEventAt: latest?.occurredAt || null,
    eventCount: events.length,
    recentChangeCount: recentChanges.length,
    staleAreaCount: staleAreas.length,
    momentum: primaryMomentum,
    confidence: events.length >= 4 ? 'high' : events.length >= 2 ? 'medium' : 'low',
  };
}

function groupBy(
  events: PIEEvidenceTimelineEvent[],
  keyForEvent: (event: PIEEvidenceTimelineEvent) => string,
) {
  return events.reduce<Record<string, PIEEvidenceTimelineEvent[]>>((groups, event) => {
    const key = keyForEvent(event);
    groups[key] = [...(groups[key] || []), event];
    return groups;
  }, {});
}

function latestEvent(events: PIEEvidenceTimelineEvent[]) {
  return [...events].sort((left, right) => timestamp(right.occurredAt) - timestamp(left.occurredAt))[0] || null;
}

function hasRepeatedIssue(events: PIEEvidenceTimelineEvent[]) {
  const issueEvents = events.filter(event =>
    event.type === 'issue_opened' ||
    /issue|blocked|safety|delay|overdue/i.test(event.summary),
  );
  const byIssue = groupBy(issueEvents, event =>
    event.issueId || event.areaName || event.summary.toLowerCase().slice(0, 40),
  );
  return Object.values(byIssue).some(group => group.length >= 2);
}

function changeSummary(
  event: PIEEvidenceTimelineEvent,
  previous: PIEEvidenceTimelineEvent | null,
) {
  if (!previous) return `Timeline started with ${event.summary}`;
  if (event.type === 'issue_resolved') return `Issue resolved: ${event.summary}`;
  if (event.type === 'issue_opened') return `Issue opened: ${event.summary}`;
  if (event.type === 'decision_made') return `Decision made: ${event.summary}`;
  if (event.type === 'schedule_changed') return `Schedule changed: ${event.summary}`;
  return `New evidence after ${previous.type}: ${event.summary}`;
}

function changeTypeForEvent(
  event: PIEEvidenceTimelineEvent,
): PIEEvidenceTimelineChange['changeType'] {
  if (event.type === 'issue_opened') return 'risk';
  if (event.type === 'issue_resolved') return 'resolution';
  if (event.type === 'decision_needed' || event.type === 'decision_made') return 'decision';
  if (event.type === 'user_corrected') return 'correction';
  if (event.type === 'photo_added' || event.type === 'note_added' || event.type === 'inspection_updated') return 'progress';
  return 'new_activity';
}

function daysBetween(
  earlier: string,
  later: string,
) {
  const left = timestamp(earlier);
  const right = timestamp(later);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round((right - left) / 86_400_000));
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
