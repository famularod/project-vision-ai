import { buildVitruviusMyWork } from '../../services/VitruviusMyWork';
import type { ProjectControls, ScheduleItem } from '../../types';

describe('VitruviusMyWork', () => {
  test('matches legacy owners by exact normalized display name', () => {
    const work = buildVitruviusMyWork({
      items: [
        item('mine', { owner: '  DAVID   FAMULARO  ' }),
        item('not-mine', { owner: 'David Famularo Jr.' }),
        item('substring', { owner: 'Davidson Famularo' }),
      ],
      displayName: 'David Famularo',
      email: 'famularod@gmail.com',
      now: NOW,
    });

    expect(work.identityAliases).toEqual([
      'david famularo',
      'famularod@gmail.com',
    ]);
    expect(work.items.map(row => row.item.id)).toEqual(['mine']);
    expect(work.items[0]).toMatchObject({
      assignment: 'DAVID FAMULARO',
      assignmentSource: 'legacy_owner',
    });
    expect(work.counts.open).toBe(1);
  });

  test('matches the project-controls assignee by exact normalized email', () => {
    const work = buildVitruviusMyWork({
      items: [
        item('assigned-by-email', {
          owner: 'Project Manager',
          projectControls: controls({ assignee: ' FAMULAROD@GMAIL.COM ' }),
        }),
        item('similar-email', {
          owner: '',
          projectControls: controls({ assignee: 'famularod+field@gmail.com' }),
        }),
      ],
      displayName: 'David Famularo',
      email: 'famularod@gmail.com',
      now: NOW,
    });

    expect(work.items.map(row => row.item.id)).toEqual(['assigned-by-email']);
    expect(work.items[0]).toMatchObject({
      assignment: 'FAMULAROD@GMAIL.COM',
      assignmentSource: 'project_controls',
    });
  });

  test('does not fall back to a former owner after explicit reassignment', () => {
    const work = buildVitruviusMyWork({
      items: [
        item('reassigned', {
          owner: 'David Famularo',
          projectControls: controls({ assignee: 'other.pm@example.com' }),
        }),
      ],
      displayName: 'David Famularo',
      email: 'famularod@gmail.com',
      now: NOW,
    });

    expect(work.items).toEqual([]);
    expect(work.counts.open).toBe(0);
  });

  test('counts assigned open, overdue, and due-through-seven-days work', () => {
    const work = buildVitruviusMyWork({
      items: [
        item('overdue', { finishDate: '2026-07-23' }),
        item('due-today', { finishDate: '2026-07-24' }),
        item('due-seven', { finishDate: '2026-07-31' }),
        item('due-later', { finishDate: '2026-08-01' }),
        item('undated', { finishDate: '' }),
        item('complete', {
          finishDate: '2026-07-20',
          status: 'Complete',
          percentComplete: 100,
        }),
        item('summary', { isSummary: true }),
        item('someone-else', { owner: 'Other PM' }),
      ],
      displayName: 'David Famularo',
      email: 'famularod@gmail.com',
      now: NOW,
    });

    expect(work.items.map(row => row.item.id)).toEqual([
      'overdue',
      'due-today',
      'due-seven',
      'due-later',
      'undated',
    ]);
    expect(work.items.map(row => row.dueState)).toEqual([
      'overdue',
      'due_within_7_days',
      'due_within_7_days',
      'later',
      'undated',
    ]);
    expect(work.counts).toEqual({
      open: 5,
      overdue: 1,
      due7: 2,
      unassigned: 0,
    });
  });

  test('counts open tasks as unassigned only when both assignment fields are empty', () => {
    const work = buildVitruviusMyWork({
      items: [
        item('unassigned', {
          owner: '  ',
          projectControls: controls({ assignee: '' }),
        }),
        item('legacy-assigned-to-other', {
          owner: 'Other PM',
          projectControls: controls({ assignee: '' }),
        }),
        item('controls-assigned-to-other', {
          owner: '',
          projectControls: controls({ assignee: 'other@example.com' }),
        }),
        item('complete-unassigned', {
          owner: '',
          projectControls: controls({ assignee: '' }),
          status: 'Complete',
          percentComplete: 100,
        }),
      ],
      displayName: 'David Famularo',
      email: 'famularod@gmail.com',
      now: NOW,
    });

    expect(work.items).toEqual([]);
    expect(work.unassignedItems.map(row => row.item.id)).toEqual(['unassigned']);
    expect(work.counts).toEqual({
      open: 0,
      overdue: 0,
      due7: 0,
      unassigned: 1,
    });
  });

  test('uses each task project timezone for calendar-day due classification', () => {
    const sameInstant = new Date('2026-07-24T01:00:00.000Z');
    const work = buildVitruviusMyWork({
      items: [
        item('los-angeles', {
          finishDate: '2026-07-23',
          projectTimeZone: 'America/Los_Angeles',
        }),
        item('tokyo', {
          finishDate: '2026-07-23',
          projectTimeZone: 'Asia/Tokyo',
        }),
      ],
      displayName: 'David Famularo',
      now: sameInstant,
    });

    expect(work.items.map(row => ({
      id: row.item.id,
      state: row.dueState,
      days: row.daysUntilDue,
    }))).toEqual([
      { id: 'tokyo', state: 'overdue', days: -1 },
      { id: 'los-angeles', state: 'due_within_7_days', days: 0 },
    ]);
    expect(work.counts).toMatchObject({ overdue: 1, due7: 1 });
  });
});

const NOW = new Date('2026-07-24T19:00:00.000Z');

function item(
  id: string,
  overrides: Partial<ScheduleItem> = {},
): ScheduleItem {
  return {
    id,
    scheduleProjectName: '2321 Compliance Project',
    projectName: '2321 Compliance Project',
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Lot',
    taskName: id,
    startDate: '2026-07-20',
    finishDate: '2026-08-15',
    milestone: '',
    owner: 'David Famularo',
    contractor: '',
    durationDays: 1,
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activity: [],
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
    ...overrides,
  };
}

function controls(
  overrides: Partial<ProjectControls> = {},
): ProjectControls {
  return {
    version: 1,
    assignee: '',
    trade: '',
    watchers: [],
    approvers: [],
    approvalStatus: 'Not Required',
    workflowStage: 'Open',
    referenceNumber: '',
    responseDueDate: '',
    checklist: [],
    linkedRecords: [],
    resources: [],
    estimatedCostImpact: null,
    estimatedScheduleImpactDays: null,
    impactConfidence: 'Medium',
    impactNotes: '',
    revision: 0,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}
