/**
 * Audit round 2, L2 (30 Sep 2026): Home, workspace and capture intelligence
 * were given every project's updates, tasks and areas. Project A's
 * intelligence carried project B's overdue task, area and safety concern, and
 * A's saved Project Truth stored B's items. The non-report input is now
 * scoped the way the daily report scopes it.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { buildRuntime } from '../../services/PIERuntime';
import { buildProjectIntelligenceAuthorityScope } from '../../services/ReportAuthorityScope';
import type { ProjectArea, ProjectUpdate, ScheduleItem } from '../../types';

const NOW = Date.parse('2026-09-30T15:00:00.000Z');
const DAY = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function task(id: string, project: string, area: string, name: string, finishDaysAgo: number): ScheduleItem {
  return {
    id, projectName: project, scheduleProjectName: project, locationName: area, taskName: name,
    startDate: day(NOW - 30 * DAY), finishDate: day(NOW - finishDaysAgo * DAY), milestone: '', owner: 'David',
    contractor: '', percentComplete: 40, priority: 'High', status: 'In Progress', notes: '',
    importedFrom: 'schedule.pdf', importedAt: '2026-09-01T08:00:00.000Z',
  } as ScheduleItem;
}

function update(id: string, project: string, area: string, notes: string, safety = false): ProjectUpdate {
  return {
    id, projectName: project, date: day(NOW - 2 * DAY), notes, recipients: { contactIds: [] }, status: 'sent',
    selectedAreaName: area,
    photos: [{
      id: `${id}-photo`, uri: `file:///p/${id}.jpg`, caption: '', category: safety ? 'Safety Concern' : 'Update',
      actionRequired: safety ? 'Guardrail missing at the Bravo mezzanine edge' : '', actionOwner: '',
      actionDueDate: '', actionStatus: safety ? 'Open' : 'Closed', selectedAreaName: area,
      locationCapturedAt: new Date(NOW - 2 * DAY).toISOString(),
    }],
  } as unknown as ProjectUpdate;
}

const areas: ProjectArea[] = [
  { id: 'a1', name: 'Alpha North Bay', projectName: 'Alpha Hangar', latitude: 1, longitude: 1, radiusFeet: 150 },
  { id: 'a2', name: 'Alpha Paint Shop', projectName: 'Alpha Hangar', latitude: 1, longitude: 1, radiusFeet: 150 },
  { id: 'b1', name: 'Bravo Mezzanine', projectName: 'Bravo Hangar', latitude: 2, longitude: 2, radiusFeet: 150 },
];
const updates = [
  update('alpha-1', 'Alpha Hangar', 'Alpha North Bay', 'Conduit run started in the north bay.'),
  update('bravo-1', 'Bravo Hangar', 'Bravo Mezzanine', 'Mezzanine framing inspection failed.', true),
];
const scheduleItems = [
  task('alpha-task', 'Alpha Hangar', 'Alpha North Bay', 'Alpha conduit rough-in', -5),
  task('bravo-task', 'Bravo Hangar', 'Bravo Mezzanine', 'Bravo mezzanine steel erection', 6),
];
const contacts = { contacts: [{ id: 'c1', name: 'Pat', email: 'pat@example.com', phone: '' }] };
const projectRecords = [{ name: 'Alpha Hangar' }, { name: 'Bravo Hangar' }] as never;
const NO_DOCUMENTS: never[] = [];

function draft(project: string, notes: string): ProjectUpdate {
  return { id: 'draft', projectName: project, date: day(NOW), photos: [], notes, recipients: { contactIds: [] }, status: 'draft' };
}

function scope(currentUpdate: ProjectUpdate | null) {
  return buildProjectIntelligenceAuthorityScope({
    selectedProjectName: 'Alpha Hangar',
    projectRecords,
    updates,
    scheduleItems,
    currentUpdate,
    projectAreas: areas,
    referenceDocuments: NO_DOCUMENTS,
    projectDocuments: NO_DOCUMENTS,
    captureMemories: NO_DOCUMENTS,
    contacts,
  });
}

describe('L2: project A\'s intelligence holds only project A', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('scopes updates, tasks and areas to the project; keeps its own unreferenced area and every contact', () => {
    const scoped = scope(null);
    expect(scoped.updates.map(item => item.id)).toEqual(['alpha-1']);
    expect(scoped.scheduleItems.map(item => item.id)).toEqual(['alpha-task']);
    expect(scoped.projectAreas.map(area => area.id)).toEqual(['a1', 'a2']);
    expect(scoped.contacts).toBe(contacts);
    expect(scoped.projectNames).toEqual(['Alpha Hangar']);
  });

  it('carries the open draft only when it belongs to the project, and keeps the same arrays while typing', () => {
    const first = scope(draft('Alpha Hangar', 'R'));
    const second = scope(draft('Alpha Hangar', 'Ro'));
    expect(first.currentUpdate?.notes).toBe('R');
    expect(second.currentUpdate?.notes).toBe('Ro');
    expect(second.updates).toBe(first.updates);
    expect(second.scheduleItems).toBe(first.scheduleItems);
    expect(second.projectAreas).toBe(first.projectAreas);
    expect(scope(draft('Bravo Hangar', 'Other project draft')).currentUpdate).toBeNull();
  });

  it('project B\'s overdue task, area and safety concern stay out of project A\'s runtime', () => {
    const scoped = scope(null);
    const runtime = buildRuntime({
      projectName: 'Alpha Hangar',
      projectNames: ['Alpha Hangar'],
      updates: scoped.updates,
      scheduleItems: scoped.scheduleItems,
      currentUpdate: scoped.currentUpdate,
      projectAreas: scoped.projectAreas,
      contacts: scoped.contacts,
      referenceDocuments: scoped.referenceDocuments,
      surface: 'home',
    });
    expect(runtime.projectNames).toEqual(['Alpha Hangar']);
    expect(runtime.overdueTasks.map(item => item.task)).not.toContain('Bravo mezzanine steel erection');
    const text = JSON.stringify(runtime);
    expect(text).not.toContain('Bravo mezzanine steel erection');
    expect(text).not.toContain('Bravo Mezzanine');
    expect(text).not.toContain('Guardrail missing');
  });
});
