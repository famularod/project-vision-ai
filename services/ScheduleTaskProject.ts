import { operationalProjectIdentityFailureKind } from './OperationalProjectIdentity';

/**
 * The project Add Task saves a task under (whole-app audit A3 pass 6 M1,
 * 30 Sep 2026). The Project field took any typed name and offered closed
 * projects, defaulting to the newest project even once it was closed. A task
 * under a name the cloud has no open project for was saved on the phone,
 * never uploaded, and the save said other devices would get it. Add Task now
 * offers open projects only, and a typed name must be an open project's
 * (matched without regard to case or spacing, saved as that project's exact
 * name) or the save is refused.
 */

export type ScheduleTaskProjectRecord = Readonly<{ id?: string | null; name: string }>;

export type ScheduleTaskProjectCheck =
  | Readonly<{ ok: true; projectName: string }>
  | Readonly<{ ok: false; reason: 'empty' | 'closed' | 'unknown'; title: string; message: string }>;

type ProjectLists = Readonly<{
  /** Every project name this device knows; a closed project may be on it too. */
  projects: readonly string[];
  closedProjects?: readonly string[] | null;
}>;

const exactKey = (value: string) => value.trim().toLocaleLowerCase('en-US');
const spacingKey = (value: string) => exactKey(value).replace(/\s+/g, ' ');

/** The open projects, in the given order, each once. */
export function openScheduleTaskProjects({ projects, closedProjects }: ProjectLists): string[] {
  const closed = new Set((closedProjects || []).map(exactKey));
  const seen = new Set<string>();
  return projects.flatMap(project => {
    const name = project.trim();
    const key = exactKey(name);
    if (!name || closed.has(key) || seen.has(key)) return [];
    seen.add(key);
    return [name];
  });
}

/** The project in view when it is open, otherwise the first open project. */
export function defaultScheduleTaskProject(
  input: ProjectLists & Readonly<{ projectInView?: string | null }>,
): string {
  const open = openScheduleTaskProjects(input);
  return (input.projectInView ? matchName(input.projectInView, open) : null) || open[0] || '';
}

export function checkScheduleTaskProject(
  input: ProjectLists & Readonly<{
    projectName: string;
    projectRecords?: readonly ScheduleTaskProjectRecord[] | null;
  }>,
): ScheduleTaskProjectCheck {
  const typed = input.projectName.trim();
  if (!typed) {
    return {
      ok: false,
      reason: 'empty',
      title: 'Project needed',
      message: 'Choose the project this task belongs to.',
    };
  }
  // A project's cloud id names it too.
  const byId = (input.projectRecords || []).find(record =>
    record.id && exactKey(record.id) === exactKey(typed))?.name.trim();
  const named = byId || typed;
  const closed = matchName(named, (input.closedProjects || []).map(name => name.trim()));
  const open = matchName(named, openScheduleTaskProjects(input));
  if (open) return { ok: true, projectName: open };
  if (closed) {
    return {
      ok: false,
      reason: 'closed',
      title: 'Project closed',
      message: `${closed} is closed. Reopen it on Overview to add tasks.`,
    };
  }
  return {
    ok: false,
    reason: 'unknown',
    title: 'Project not found',
    message: `No open project is named “${typed}”. Choose one from the list, or add it first with Add project on Overview.`,
  };
}

/**
 * What a task save says when the cloud has not taken the task yet. A task
 * whose project is not open in the cloud is not retried into the cloud by
 * waiting, so it is not described as "still retrying". Unless this phone's
 * own create or reopen of that project is still queued: tasks are sent ahead
 * of project changes, and the task uploads right after it (whole-app audit
 * A3 pass 7 L1).
 */
export function scheduleTaskSaveNotice(
  input: Readonly<{
    projectName?: string | null;
    errors?: readonly string[] | null;
    /** From runScheduleItemCloudSync: the project's create or reopen still waits on this phone. */
    projectStillUploading?: boolean | null;
    /** From runScheduleItemCloudSync: the project has a deletion record, and the task was not left waiting (sync batch Y4, item 3). */
    projectDeletedInCloud?: boolean | null;
  }>,
): Readonly<{ title: string; message: string }> {
  const kind = operationalProjectIdentityFailureKind((input.errors || []).join(' '));
  const projectName = input.projectName?.trim();
  if (input.projectDeletedInCloud) {
    return {
      title: 'Task saved on this device only',
      message: `${projectName ? `“${projectName}”` : 'This task’s project'} has been deleted, so this task was not sent and other devices will not get it.`,
    };
  }
  if (kind === 'not_open' && input.projectStillUploading) {
    return {
      title: 'Task saved on this device',
      message: `${projectName ? `“${projectName}”` : 'This task’s project'} is still on its way to the cloud. The task uploads right after it.`,
    };
  }
  if (kind === 'not_open') {
    return {
      title: 'Task saved on this device only',
      message: `${projectName ? `“${projectName}”` : 'This task’s project'} is not an open project in the cloud, so other devices will not get this task. It uploads once the project is open: reopen it on Overview if it was closed.`,
    };
  }
  if (kind === 'unresolved') {
    return {
      title: 'Task saved on this device only',
      message: 'The cloud could not tell which project this task belongs to, so other devices will not get it. Check the task’s project on this device.',
    };
  }
  return {
    title: 'Task saved on this device',
    message: 'Vitruvius is still retrying this task’s cloud sync. Other devices will update after the cloud accepts it.',
  };
}

function matchName(value: string, names: readonly string[]): string | null {
  const exact = names.filter(name => exactKey(name) === exactKey(value));
  if (exact.length > 0) return exact[0];
  const spaced = names.filter(name => spacingKey(name) === spacingKey(value));
  return spaced.length === 1 ? spaced[0] : null;
}
