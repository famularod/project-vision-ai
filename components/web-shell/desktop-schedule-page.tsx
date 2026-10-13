import Ionicons from '@expo/vector-icons/Ionicons';
import { createElement, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  buildDAVEWebScheduleItem,
  createDAVEWebTaskId,
  DAVE_WEB_CONFLICT_CHOICE_TEXT,
  daveWebNewTaskProjectId,
  daveWebPercentFromBox,
  daveWebTaskProjectRepairedNotice,
  daveWebScheduleDateForSave,
  mergeDAVEWebConflictDraft,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';
import { DAVEWebTaskMutationError } from '../../services/DAVEWebSupabaseClient';
import { daveWebLinkCircleRefusal } from '../../services/DAVEWebTaskLinkCircle';
import {
  buildVitruviusGanttModel,
  parseVitruviusScheduleDate,
  type VitruviusGanttZoom,
} from '../../services/VitruviusGanttModel';
import {
  buildVitruviusLookahead,
  lookaheadStatusLabel,
  vitruviusLookaheadCsv,
  type VitruviusLookaheadItem,
  type VitruviusLookaheadWeeks,
} from '../../services/VitruviusLookahead';
import { buildVitruviusCalendarExport } from '../../services/VitruviusCalendarExport';
import { analyzeVitruviusSchedule } from '../../services/VitruviusScheduleAnalytics';
import {
  buildVitruviusScheduleChangeScenario,
  type VitruviusScheduleChangeScenario,
} from '../../services/VitruviusScheduleChangeScenario';
import {
  buildVitruviusScheduleHierarchy,
  nextScheduleSortOrder,
  nextScheduleWbsCode,
  planningDependenciesFromIds,
  scheduleParentOptions,
  schedulePredecessorOptions,
  scheduleSuccessorIds,
} from '../../services/VitruviusScheduleWorkspace';
import { scheduleCalendarDay } from '../../services/ScheduleCalendarDay';
import {
  scheduleDateRangeText,
  scheduleDayIsSupported,
  scheduleDurationBoxProblem,
  scheduleLagBoxProblem,
} from '../../services/ScheduleInputLimits';
import { scheduleTaskLinkTargets } from '../../services/ScheduleTaskRevisions';
import type { ScheduleItem, ScheduleStatus } from '../../types';
import { colors, spacing } from '../../theme';
import { useDesktopAuth } from './desktop-auth-provider';
import { desktopSurfaces } from './desktop-surface-palette';

type ScheduleEditorKind = 'task' | 'phase' | 'milestone';
type ScheduleBuilderConflict = Readonly<{
  taskId: string;
  /** The version the editor was opened on: fields equal to it were left alone. */
  base: DAVEWebScheduleItem;
}>;
type ScheduleWorkspaceView = 'builder' | 'gantt' | 'lookahead';

type ScheduleEditorState = Readonly<{
  kind: ScheduleEditorKind;
  taskName: string;
  projectName: string;
  locationName: string;
  wbsCode: string;
  parentItemId: string;
  startDate: string;
  finishDate: string;
  baselineStartDate: string;
  baselineFinishDate: string;
  durationDays: string;
  predecessorItemIds: readonly string[];
  lagDays: string;
  owner: string;
  contractor: string;
  percentComplete: string;
  /** He typed in the Percent complete box and it holds something (WS1 item 5): his own entry. */
  percentEntered?: boolean;
  status: ScheduleStatus;
  notes: string;
}>;

export function DesktopSchedulePage({
  tasks,
  projects,
  selectedProject,
}: {
  tasks: readonly DAVEWebScheduleItem[];
  projects: readonly string[];
  selectedProject: string | null;
}) {
  const auth = useDesktopAuth();
  // Review pass 1, web M1 (6 Oct 2026; caused by WS1 item 8). `tasks` is what the page lists: the tasks of the
  // project chosen at the top of the workspace (those filed under that schedule name). It is not the schedule. The
  // page took "not among the tasks I was handed" for "not in the schedule": with a project chosen, a predecessor
  // that is alive and shown but filed under another schedule name read "Missing" in the list, and WS1 item 8's
  // editor called it "A task no longer in the schedule" and told him to untick it. The case found: a task added by
  // hand on the web (filed under its building's name) that starts after a task of a Microsoft Project master (filed
  // under the master's own root name). What a link names is now read from the whole schedule the workspace shows,
  // whatever is chosen at the top: the tasks handed, with every other task shown.
  const workspaceTasks = auth.snapshot?.scheduleItems;
  const scheduleTasks = useMemo(() => {
    const handed = new Set(tasks.map(task => task.id));
    const others = (workspaceTasks ?? []).filter(task => !handed.has(task.id));
    return others.length > 0 ? [...tasks, ...others] : tasks;
  }, [tasks, workspaceTasks]);
  // A link to a row a master hid reads as the row shown for its task (owner answer Q29). The rule the web's circle
  // check and its deletes use for "is this task in the schedule shown" (scheduleTaskLinkTargets over every task shown).
  const knownTasks = auth.snapshot?.knownScheduleItems;
  const linkTarget = useMemo(() => scheduleTaskLinkTargets(scheduleTasks, knownTasks ?? []), [scheduleTasks, knownTasks]);
  /** The row shown for a link's predecessor id: a link the editor re-points there is not a new link (WS1 item 7). */
  const shownLinkId = (predecessorId: string) => linkTarget(predecessorId)?.id ?? predecessorId;
  /** The schedule this tab shows, for the sentence of a refused link: a circle all in it was not made elsewhere (second review, F7). */
  const scheduleHere = { scheduleItems: scheduleTasks as DAVEWebScheduleItem[], knownScheduleItems: (knownTasks ?? scheduleTasks) as DAVEWebScheduleItem[] };
  const [editor, setEditor] = useState<ScheduleEditorState | null>(null);
  const [editingTask, setEditingTask] = useState<DAVEWebScheduleItem | null>(null);
  const [workspaceView, setWorkspaceView] = useState<ScheduleWorkspaceView>('builder');
  const [ganttZoom, setGanttZoom] = useState<VitruviusGanttZoom>('week');
  const [lookaheadWeeks, setLookaheadWeeks] = useState<VitruviusLookaheadWeeks>(3);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [impactPendingItemId, setImpactPendingItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);
  const [conflict, setConflict] = useState<ScheduleBuilderConflict | null>(null);
  const projectNames = uniqueText([
    ...(selectedProject ? [selectedProject] : []),
    ...projects,
    ...tasks.map(taskProjectName),
  ]);
  // Each task under its app project (A5 pass 12 K1). The project chosen shows
  // with no items only while there are none: chosen as a schedule's root, its
  // tasks show under their buildings, not under an empty root heading.
  const groupedProjects = useMemo(
    () => projectNames
      .map(projectName => ({
        projectName,
        tasks: tasks.filter(task => inProject(task, projectName)),
      }))
      .filter(group => group.tasks.length > 0 || (selectedProject === group.projectName && tasks.length === 0)),
    [projectNames, selectedProject, tasks],
  );
  const defaultProject = selectedProject || projectNames[0] || '';
  const editorProjectTasks = editor
    ? tasks.filter(task => inProject(task, editor.projectName))
    : [];
  // The task's own parent and predecessors in another building under its
  // root, set while the page grouped by root (A5 pass 13 L1): listed so they
  // can be seen and removed. Saving had kept them with no way to uncheck them.
  const editorLinksElsewhere = editor && editingTask
    ? tasks.filter(task =>
        !inProject(task, editor.projectName) &&
        sameRoot(task, editingTask) &&
        (task.id === editingTask.parentItemId?.trim() ||
          (editingTask.dependencies || []).some(dependency => dependency.predecessorItemId === task.id)),
      )
    : [];
  // The predecessors the editor opened with, as the rows shown: one of them that also comes after the item is part of
  // a circle saved from two places, and is listed so that he can always untick it (WS1 item 7).
  const editorOpenedPredecessorIds = useMemo(
    () => (editingTask ? scheduleEditorStateFor(editingTask, linkTarget).predecessorItemIds : []),
    [editingTask, linkTarget],
  );
  // A predecessor the item still names that is no task shown now: its task was deleted (a delete on the web used to
  // leave the link behind), or its schedule is not the current one. Listed so that he can untick it (WS1 item 8).
  // By the schedule the workspace shows, not by the tasks handed (M1): a task shown under another project is alive.
  const editingTaskId = editingTask?.id ?? null;
  const editorMissingPredecessorIds = useMemo(
    () => editorOpenedPredecessorIds.filter(id =>
      !tasks.some(task => task.id === id) && !livePredecessor(linkTarget, id, editingTaskId)),
    [editorOpenedPredecessorIds, tasks, linkTarget, editingTaskId],
  );
  // The tasks that come after the item in the schedule shown: one of them as its predecessor too is a circle.
  const editorSuccessorIds = useMemo(
    () => (editingTaskId ? scheduleSuccessorIds(editingTaskId, scheduleTasks) : new Set<string>()),
    [editingTaskId, scheduleTasks],
  );
  // The predecessors the item has, or holds ticked in the open form, that are in the schedule shown but in none of
  // the editor's lists (M1): filed under another schedule name than the one chosen at the top, or in another project
  // altogether. Each under the id the link names, with the task shown for it. Listed by name with where they are
  // filed, ticked: he can untick one as he can any other, and none is called missing.
  const editorPredecessorsElsewhere = (() => {
    if (!editor || !editingTask) return [];
    const listed = new Set([...editorProjectTasks, ...editorLinksElsewhere].map(task => task.id));
    const found = new Set<string>();
    return [...editor.predecessorItemIds, ...editorOpenedPredecessorIds].flatMap(id => {
      if (listed.has(id) || found.has(id)) return [];
      const item = livePredecessor(linkTarget, id, editingTask.id);
      if (!item || listed.has(item.id) || found.has(item.id)) return [];
      found.add(id).add(item.id);
      return [{ id, item, circular: editorSuccessorIds.has(item.id) }];
    });
  })();
  const editorScenario = useMemo(() => {
    if (!editor || !editingTask || editor.kind === 'phase') return null;
    return buildVitruviusScheduleChangeScenario({
      // The schedule shown, not the tasks handed (M1): the item's own schedule is then whole whatever is chosen at
      // the top (also when the choice changes under the open editor and the item is no longer among the tasks
      // handed), and a predecessor shown under another schedule name is found.
      items: scheduleTasks,
      shownTaskOf: linkTarget,
      itemId: editingTask.id,
      draft: {
        startDate: editor.startDate,
        finishDate: editor.kind === 'milestone'
          ? editor.startDate
          : editor.finishDate,
        durationDays: editor.kind === 'milestone'
          ? 0
          : numberOrNull(editor.durationDays),
        dependencies: planningDependenciesFromIds(
          editor.predecessorItemIds,
          numberOrZero(editor.lagDays),
        ),
        isMilestone: editor.kind === 'milestone',
        status: editor.status,
        // A blank box keeps the stored percent, as Save does (A12 pass 5 L1).
        percentComplete: editor.percentComplete.trim()
          ? numberOrZero(editor.percentComplete)
          : editingTask.percentComplete,
      },
    });
  }, [editingTask, editor, scheduleTasks, linkTarget]);

  const openNew = (kind: ScheduleEditorKind, parentItemId: string | null = null) => {
    const projectTasks = tasks.filter(task => inProject(task, defaultProject));
    setEditingTask(null);
    setConflict(null);
    setEditor({
      kind,
      taskName: '',
      projectName: defaultProject,
      locationName: '',
      wbsCode: nextScheduleWbsCode(parentItemId, projectTasks),
      parentItemId: parentItemId || '',
      startDate: '',
      finishDate: '',
      baselineStartDate: '',
      baselineFinishDate: '',
      durationDays: kind === 'milestone' ? '0' : kind === 'phase' ? '' : '1',
      predecessorItemIds: [],
      lagDays: '0',
      owner: 'Project manager',
      contractor: '',
      percentComplete: '0',
      status: 'Not Started',
      notes: '',
    });
    setNotice(null);
  };

  const openEdit = (task: DAVEWebScheduleItem) => {
    setEditingTask(task);
    setEditor(scheduleEditorStateFor(task, linkTarget));
    setConflict(null);
    setNotice(null);
  };

  /**
   * The form checked and turned into a task draft. `opened` is the version
   * the editor was opened on (null for a new item).
   */
  const prepareDraft = (
    form: ScheduleEditorState,
    opened: DAVEWebScheduleItem | null,
  ): Readonly<{ ok: true; draft: DAVEWebTaskDraft }> | Readonly<{ ok: false; message: string }> => {
    if (!form.taskName.trim() || !form.projectName.trim()) {
      return { ok: false, message: 'Task name and project are required.' };
    }
    if (
      opened &&
      normalize(form.projectName) !== normalize(taskProjectName(opened))
    ) {
      return {
        ok: false,
        message: 'Move work between projects by creating it in the destination project, then remove the old item after review.',
      };
    }
    // An emptied box keeps the percent the item was opened with, and so its
    // source; it had saved 0% as his judgment (whole-app audit A12 pass 5 L1).
    const percent = daveWebPercentFromBox(form.percentComplete, opened?.percentComplete);
    if (!percent.ok) return percent;
    const percentComplete = percent.percentComplete;
    const startDate = form.startDate.trim();
    const finishDate = form.kind === 'milestone'
      ? startDate
      : form.finishDate.trim();
    const parsedStart = parseVitruviusScheduleDate(startDate);
    const parsedFinish = parseVitruviusScheduleDate(finishDate);
    if (form.kind === 'milestone' && !parsedStart) {
      return { ok: false, message: 'A milestone date is required.' };
    }
    if (startDate && !parsedStart) {
      return { ok: false, message: 'Start date is not valid.' };
    }
    if (finishDate && !parsedFinish) {
      return { ok: false, message: 'Finish date is not valid.' };
    }
    if (
      parsedStart &&
      parsedFinish &&
      parsedFinish.getTime() < parsedStart.getTime()
    ) {
      return { ok: false, message: 'Finish date cannot be before the start date.' };
    }
    // Independent review R08: the limits are checked here, before the save
    // builds or calculates anything. A phase's duration, lag and dates are
    // not in its form.
    if (form.kind !== 'phase') {
      const limitProblem = scheduleEditorLimitProblem(form, opened);
      if (limitProblem) return { ok: false, message: limitProblem };
    }
    const projectTasks = tasks.filter(task => inProject(task, form.projectName));
    // A new item's cloud project is looked up by its project's name among
    // the open projects, as on the Tasks page. It had been copied from
    // another task of the project: with no task yet nothing could be added,
    // and one task saved with another project's id passed that wrong id to
    // every new item, which the phone would not upload (whole-app audit A12
    // pass 5 M1, 30 Sep 2026). An existing item keeps its stored id.
    let projectId = opened?.projectId?.trim() || null;
    if (!projectId) {
      const project = daveWebNewTaskProjectId(auth.snapshot, form.projectName);
      if (!project.ok) return { ok: false, message: project.message };
      projectId = project.projectId;
    }
    // Dates as the task stores them, not as the date inputs hold them; an
    // unchanged day keeps its stored text (whole-app audit A12 pass 3 M2).
    // A box that still shows what the stored date showed keeps the stored
    // text exactly, "TBD" and other text that shows an empty box included
    // (whole-app audit A12 pass 4 L1, 30 Sep 2026).
    const storedDate = (value: string, stored: string | null | undefined) =>
      opened && value.trim() === dateInputValue(stored)
        ? stored ?? ''
        : daveWebScheduleDateForSave(value, stored, scheduleDatesOf(opened));
    // A phase's dates are not in the builder's form, so it never writes
    // them: they had been saved blank, and Apply My Changes on a phase
    // blanked the phone's newer phase dates (A12 pass 4 L1).
    const phaseDate = (stored: string | null | undefined) => stored ?? '';
    // Nor are a phase's predecessors, lag, duration, baseline dates or
    // milestone flag: a phase leaves them out of its draft, so the save
    // keeps them as stored and Apply My Changes keeps the newer version's.
    // A phase had been saved with no dependencies, which wiped those set on
    // the phone (whole-app audit A12 pass 4 residual R2, 30 Sep 2026).
    const isPhase = form.kind === 'phase';
    return {
      ok: true,
      draft: {
        projectId,
        // The item's own type: the builder saved every item as a Task, so an
        // RFI or Issue lost its type and a closed one could not be saved
        // (whole-app audit round 2 F5, 30 Sep 2026).
        itemType: opened?.itemType ?? 'Task',
        taskName: form.taskName,
        projectName: form.projectName,
        locationName: form.locationName,
        startDate: isPhase
          ? phaseDate(opened?.startDate)
          : storedDate(startDate, opened?.startDate),
        finishDate: isPhase
          ? phaseDate(opened?.finishDate)
          : storedDate(finishDate, opened?.finishDate),
        milestone: scheduleBuilderMilestoneText(form, opened),
        owner: form.owner,
        contractor: form.contractor,
        percentComplete,
        percentEntered: form.percentEntered === true && Boolean(form.percentComplete.trim()),
        priority: opened?.priority || 'Medium',
        status: form.status,
        notes: form.notes,
        nextAction: opened?.nextAction || '',
        activityMessage: '',
        wbsCode: form.wbsCode,
        parentItemId: form.parentItemId,
        sortOrder: opened?.sortOrder ??
          nextScheduleSortOrder(form.parentItemId || null, projectTasks),
        durationDays: isPhase
          ? undefined
          : form.kind === 'milestone' ? 0 : form.durationDays,
        dependencies: isPhase
          ? undefined
          : planningDependenciesFromIds(form.predecessorItemIds, form.lagDays),
        isSummary: isPhase,
        isMilestone: isPhase ? undefined : form.kind === 'milestone',
        baselineStartDate: isPhase
          ? undefined
          : storedDate(form.baselineStartDate, opened?.baselineStartDate),
        baselineFinishDate: isPhase
          ? undefined
          : storedDate(
              form.kind === 'milestone' ? form.baselineStartDate : form.baselineFinishDate,
              opened?.baselineFinishDate,
            ),
        projectControls: opened?.projectControls ?? null,
      },
    };
  };

  const closeEditor = () => {
    setEditor(null);
    setEditingTask(null);
    setConflict(null);
  };

  const save = async () => {
    // While another device's newer version is waiting for his choice, Save
    // would send the version he opened and be refused again (audit round 2 F7).
    if (!editor || pending || conflict) return;
    const prepared = prepareDraft(editor, editingTask);
    if (!prepared.ok) {
      setNotice({ tone: 'danger', text: prepared.message });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const now = new Date().toISOString();
      const item = buildDAVEWebScheduleItem({
        draft: prepared.draft,
        current: editingTask,
        id: editingTask?.id || createDAVEWebTaskId(),
        now,
        actor: auth.userEmail || 'Project manager',
        projects: auth.snapshot, // a task saved earlier under another project's name is repaired here (WS1 item 6)
      });
      // A predecessor added here that already comes after this item in the cloud (linked the other way on another
      // device or in another tab) would close a circle: refused, with what he typed kept (WS1 item 7).
      const circle = editingTask ? await daveWebLinkCircleRefusal({ item, opened: editingTask, shownIdOf: shownLinkId, here: scheduleHere }) : null;
      if (circle) {
        setNotice({ tone: 'danger', text: circle });
        return;
      }
      if (editingTask) await auth.updateTask(item);
      else await auth.createTask(item);
      closeEditor();
      setNotice({
        tone: 'good',
        text: editingTask
          ? `Schedule item updated and synced.${daveWebTaskProjectRepairedNotice(editingTask, item)}`
          : 'Schedule item created and synced.',
      });
    } catch (error) {
      // A save refused because another device changed the item keeps what
      // he typed and offers the Tasks page's two choices. Loading the latest
      // version over his edits threw them away (audit round 2 follow-up,
      // 30 Sep 2026); before that the builder kept the stale copy and every
      // later save was refused (audit round 2 F7).
      if (editingTask && error instanceof DAVEWebTaskMutationError && error.code === 'conflict') {
        const refreshed = await auth.refreshSnapshot().catch(() => false);
        if (refreshed) {
          setConflict({ taskId: editingTask.id, base: editingTask });
          setNotice({
            tone: 'danger',
            text: 'Another device changed this schedule item while you were editing. Choose which version to continue with.',
          });
          return;
        }
        setNotice({
          tone: 'danger',
          text: 'Another device changed this schedule item while you were editing, and the latest version could not be loaded. Refresh the workspace, then open the item again.',
        });
        return;
      }
      if (await refreshAfterRefusedWrite(error)) closeEditor();
      setNotice({
        tone: 'danger',
        text: error instanceof Error
          ? error.message
          : 'The schedule item could not be saved.',
      });
    } finally {
      setPending(false);
    }
  };

  const loadLatestAfterConflict = () => {
    if (!conflict || pending) return;
    const latest = scheduleTasks.find(task => task.id === conflict.taskId) ?? null;
    if (!latest) {
      closeEditor();
      setNotice({
        tone: 'danger',
        text: 'This schedule item is no longer in the shared record.',
      });
      return;
    }
    setEditingTask(latest);
    setEditor(scheduleEditorStateFor(latest, linkTarget));
    setConflict(null);
    setNotice({
      tone: 'good',
      text: 'The latest shared version is loaded. Review it before saving.',
    });
  };

  const applyMyChangesAfterConflict = async () => {
    if (!conflict || !editor || pending) return;
    const latest = scheduleTasks.find(task => task.id === conflict.taskId) ?? null;
    if (!latest) {
      closeEditor();
      setNotice({
        tone: 'danger',
        text: 'This schedule item is no longer in the shared record.',
      });
      return;
    }
    // The form as it is now, edits made after the choice appeared included,
    // compared with the version he opened.
    const prepared = prepareDraft(editor, conflict.base);
    if (!prepared.ok) {
      setNotice({ tone: 'danger', text: prepared.message });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const now = new Date().toISOString();
      const actor = auth.userEmail || 'Project manager';
      // Only the fields he changed go over the other device's newer version,
      // as on the Tasks page (whole-app audit round 2 F4).
      const item = buildDAVEWebScheduleItem({
        draft: mergeDAVEWebConflictDraft({
          draft: prepared.draft,
          base: conflict.base,
          latest,
          now,
          actor,
        }),
        current: latest,
        id: latest.id,
        now,
        actor,
        projects: auth.snapshot,
      });
      // As in Save: a link this adds must not close a circle with what the cloud holds now (WS1 item 7).
      const circle = await daveWebLinkCircleRefusal({ item, opened: latest, shownIdOf: shownLinkId, here: scheduleHere });
      if (circle) {
        setNotice({ tone: 'danger', text: circle });
        return;
      }
      await auth.updateTask(item);
      closeEditor();
      setNotice({
        tone: 'good',
        text: 'The fields you changed were applied to the latest shared version and synced.',
      });
    } catch (error) {
      await auth.refreshSnapshot().catch(() => false);
      setNotice({
        tone: 'danger',
        text: error instanceof DAVEWebTaskMutationError && error.code === 'conflict'
          ? 'The schedule item changed again. Review the refreshed version before trying once more.'
          : error instanceof Error
            ? error.message
            : 'The schedule item could not be saved.',
      });
    } finally {
      setPending(false);
    }
  };

  /**
   * The gateway's refusal messages say "The workspace has been refreshed";
   * the builder now does refresh (audit round 2 F7). True when the item is
   * gone (deleted on another device), so its editor can close.
   */
  const refreshAfterRefusedWrite = async (error: unknown): Promise<boolean> => {
    if (!(error instanceof DAVEWebTaskMutationError) || error.code === 'write_failed') {
      return false;
    }
    await auth.refreshSnapshot().catch(() => false);
    return error.code === 'deleted' || error.code === 'not_found';
  };

  const applyDependencyDateChange = async (itemId: string) => {
    if (impactPendingItemId) return;
    const analysis = analyzeVitruviusSchedule(tasks);
    if (!analysis.impactPreview.safeToApply) {
      setNotice({
        tone: 'danger',
        text: 'Correct the dependency issues before applying calculated dates.',
      });
      return;
    }
    const current = tasks.find(task => task.id === itemId);
    const calculated = analysis.impactPreview.items.find(task => task.id === itemId);
    const change = analysis.impactPreview.changes.find(candidate => candidate.itemId === itemId);
    if (!current || !calculated || !change) {
      setNotice({
        tone: 'danger',
        text: 'This date change is no longer current. Refresh the schedule and review it again.',
      });
      return;
    }
    setImpactPendingItemId(itemId);
    setNotice(null);
    try {
      await auth.updateTask({
        ...current,
        ...calculatedDatesAsStored(current, calculated),
        durationDays: calculated.durationDays,
        updatedAt: new Date().toISOString(),
      });
      setNotice({
        tone: 'good',
        text: `${current.taskName} moved to ${shortDate(calculated.startDate)}–${shortDate(calculated.finishDate)} and synced.`,
      });
    } catch (error) {
      await refreshAfterRefusedWrite(error);
      setNotice({
        tone: 'danger',
        text: error instanceof Error
          ? error.message
          : 'The calculated dates could not be saved.',
      });
    } finally {
      setImpactPendingItemId(null);
    }
  };

  const applyAllDependencyDateChanges = async () => {
    if (impactPendingItemId) return;
    const analysis = analyzeVitruviusSchedule(tasks);
    if (!analysis.impactPreview.safeToApply) {
      setNotice({
        tone: 'danger',
        text: 'Correct the dependency issues before applying calculated dates.',
      });
      return;
    }
    const calculatedById = new Map(
      analysis.impactPreview.items.map(item => [item.id, item]),
    );
    const changedIds = new Set(
      analysis.impactPreview.changes.map(change => change.itemId),
    );
    const updates = tasks.flatMap(current => {
      const calculated = calculatedById.get(current.id);
      if (!calculated || !changedIds.has(current.id)) return [];
      return [{
        ...current,
        ...calculatedDatesAsStored(current, calculated),
        durationDays: calculated.durationDays,
        updatedAt: new Date().toISOString(),
      }];
    });
    if (updates.length === 0) {
      setNotice({
        tone: 'good',
        text: 'Current task dates already satisfy the saved dependencies.',
      });
      return;
    }
    setImpactPendingItemId('all');
    setNotice(null);
    // Tasks the calculation could not give dates to are left as they are and said so (review pass 1, L2).
    const leftAsItIs = analysis.impactPreview.issues.filter(issue => issue.severity === 'warning').length;
    try {
      const updated = await auth.updateTasks(updates);
      setNotice({
        tone: 'good',
        text: `${updated} calculated date change${updated === 1 ? '' : 's'} applied and synced.` + (leftAsItIs > 0
          ? ` ${leftAsItIs} task${leftAsItIs === 1 ? ' could not be calculated and was left as it is' : 's could not be calculated and were left as they are'}; see the note${leftAsItIs === 1 ? '' : 's'} in the impact preview.`
          : ''),
      });
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error
          ? `${error.message} The schedule was refreshed; review the remaining changes before applying again.`
          : 'The calculated dates could not all be saved. The schedule was refreshed.',
      });
    } finally {
      setImpactPendingItemId(null);
    }
  };

  const toggleCollapsed = (itemId: string) => {
    setCollapsedIds(current => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  return (
    <View style={styles.workspace}>
      <View style={styles.commandBar}>
        <View style={styles.commandCopy}>
          <Text style={styles.commandTitle}>
            {workspaceView === 'builder'
              ? 'Schedule Builder'
              : workspaceView === 'gantt'
                ? 'Gantt Timeline'
                : 'Construction Lookahead'}
          </Text>
          <Text style={styles.commandDetail}>
            {workspaceView === 'builder'
              ? 'Build the plan directly in Vitruvius. Create phases, tasks, milestones, and finish-to-start relationships.'
              : workspaceView === 'gantt'
                ? 'Review the complete project sequence, dates, milestones, and progress on one aligned timeline.'
                : 'Coordinate the next three or six weeks of work by project, area, responsibility, and readiness.'}
          </Text>
        </View>
        <View style={styles.commandActions}>
          <View style={styles.viewToggle}>
            <ViewToggle
              label="Builder"
              icon="list-outline"
              selected={workspaceView === 'builder'}
              onPress={() => setWorkspaceView('builder')}
            />
            <ViewToggle
              label="Gantt"
              icon="bar-chart-outline"
              selected={workspaceView === 'gantt'}
              onPress={() => setWorkspaceView('gantt')}
            />
            <ViewToggle
              label="Lookahead"
              icon="calendar-outline"
              selected={workspaceView === 'lookahead'}
              onPress={() => setWorkspaceView('lookahead')}
            />
          </View>
          <ActionButton
            icon="calendar-outline"
            label="Download Calendar"
            onPress={() => downloadScheduleCalendar(tasks)}
          />
          <ActionButton icon="layers-outline" label="Add Phase" onPress={() => openNew('phase')} />
          <ActionButton icon="add-circle-outline" label="Add Task" onPress={() => openNew('task')} primary />
          <ActionButton icon="diamond-outline" label="Add Milestone" onPress={() => openNew('milestone')} />
        </View>
      </View>

      <View style={styles.metricRow}>
        <Metric label="Phases" value={tasks.filter(task => task.isSummary).length} icon="layers-outline" />
        <Metric label="Tasks" value={tasks.filter(task => !task.isSummary && !task.isMilestone).length} icon="checkbox-outline" />
        <Metric label="Milestones" value={tasks.filter(task => task.isMilestone).length} icon="diamond-outline" />
        <Metric label="Relationships" value={tasks.reduce((sum, task) => sum + (task.dependencies?.length || 0), 0)} icon="git-merge-outline" />
      </View>

      {notice ? (
        <View style={[styles.notice, notice.tone === 'danger' && styles.noticeDanger]} accessibilityRole="alert">
          <Text style={[styles.noticeText, notice.tone === 'danger' && styles.noticeTextDanger]}>{notice.text}</Text>
        </View>
      ) : null}

      {editor && conflict ? (
        <View style={styles.conflictCard} accessibilityRole="alert">
          <View style={styles.conflictCopy}>
            <Text style={styles.conflictTitle}>Choose how to resolve this edit</Text>
            <Text style={styles.conflictText}>{DAVE_WEB_CONFLICT_CHOICE_TEXT}</Text>
          </View>
          <View style={styles.conflictActions}>
            <Pressable
              style={styles.secondaryButton}
              onPress={loadLatestAfterConflict}
              disabled={pending}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>Load Latest Version</Text>
            </Pressable>
            <Pressable
              style={styles.primaryButton}
              onPress={() => { void applyMyChangesAfterConflict(); }}
              disabled={pending}
              accessibilityRole="button"
            >
              {pending ? <ActivityIndicator color={desktopSurfaces.onAccent} /> : (
                <Text style={styles.primaryButtonText}>Apply My Changes</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      {editor ? (
        <ScheduleEditor
          state={editor}
          editingTask={editingTask}
          projects={projectNames}
          projectTasks={editorProjectTasks}
          linksElsewhere={editorLinksElsewhere}
          predecessorsElsewhere={editorPredecessorsElsewhere}
          openedPredecessorIds={editorOpenedPredecessorIds}
          missingPredecessorIds={editorMissingPredecessorIds}
          scenario={editorScenario}
          pending={pending}
          awaitingConflictChoice={Boolean(conflict)}
          onChange={setEditor}
          onCancel={closeEditor}
          onSave={() => { void save(); }}
        />
      ) : null}

      {workspaceView === 'builder' ? (
      <View style={styles.tableSurface}>
        <View style={styles.tableHeader}>
          <Text style={[styles.headerCell, styles.wbsColumn]}>WBS</Text>
          <Text style={[styles.headerCell, styles.nameColumn]}>SCHEDULE ITEM</Text>
          <Text style={[styles.headerCell, styles.areaColumn]}>AREA</Text>
          <Text style={[styles.headerCell, styles.dateColumn]}>START</Text>
          <Text style={[styles.headerCell, styles.dateColumn]}>FINISH</Text>
          <Text style={[styles.headerCell, styles.durationColumn]}>DAYS</Text>
          <Text style={[styles.headerCell, styles.predecessorColumn]}>PREDECESSORS</Text>
          <Text style={[styles.headerCell, styles.statusColumn]}>STATUS</Text>
        </View>

        {groupedProjects.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={30} color={desktopSurfaces.accent} />
            <Text style={styles.emptyTitle}>No schedule has been built yet</Text>
            <Text style={styles.emptyText}>Start with a phase, then add its tasks and milestones.</Text>
          </View>
        ) : groupedProjects.map(group => {
          const hierarchy = buildingScheduleHierarchy(group.tasks, tasks);
          return (
            <View key={group.projectName} style={styles.projectGroup}>
              <View style={styles.projectHeading}>
                <Text style={styles.projectTitle}>{group.projectName}</Text>
                <Text style={styles.projectCount}>{group.tasks.length} items</Text>
              </View>
              {hierarchy.issues.length > 0 ? (
                <View style={styles.hierarchyWarning}>
                  <Ionicons name="warning-outline" size={18} color="#8A5500" />
                  <Text style={styles.hierarchyWarningText}>
                    {hierarchy.issues.length} hierarchy issue{hierarchy.issues.length === 1 ? '' : 's'} need review.
                  </Text>
                </View>
              ) : null}
              {hierarchy.rows.map(row => {
                if (ancestorIsCollapsed(row.item, group.tasks, collapsedIds)) return null;
                const dependencyLabels = (row.item.dependencies || []).map(dependency => {
                  // One in another building under the same root is not missing (set when the page grouped by root).
                  // Nor is one the schedule shows anywhere else, outside the project chosen at the top (M1).
                  const predecessor = group.tasks.find(task => task.id === dependency.predecessorItemId) ??
                    tasks.find(task => task.id === dependency.predecessorItemId && sameRoot(task, row.item)) ??
                    shownLinkTarget(linkTarget, dependency.predecessorItemId, row.item) ??
                    livePredecessor(linkTarget, dependency.predecessorItemId, row.item.id);
                  const label = predecessor?.wbsCode || predecessor?.taskName || 'Missing';
                  return `${label}${dependency.lagDays ? ` +${dependency.lagDays}d` : ''}`;
                });
                return (
                  <Pressable
                    key={row.item.id}
                    style={({ pressed }) => [
                      styles.tableRow,
                      row.item.isSummary && styles.summaryRow,
                      row.orphaned && styles.orphanRow,
                      pressed && styles.rowPressed,
                    ]}
                    onPress={() => openEdit(row.item as DAVEWebScheduleItem)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${row.item.taskName}`}
                  >
                    <Text style={[styles.cell, styles.wbsColumn]}>{row.item.wbsCode || '—'}</Text>
                    <View style={[styles.nameCell, styles.nameColumn, { paddingLeft: row.depth * 22 }]}>
                      {row.childCount > 0 ? (
                        <Pressable
                          style={styles.collapseButton}
                          onPress={event => {
                            event.stopPropagation();
                            toggleCollapsed(row.item.id);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`${collapsedIds.has(row.item.id) ? 'Expand' : 'Collapse'} ${row.item.taskName}`}
                        >
                          <Ionicons
                            name={collapsedIds.has(row.item.id) ? 'chevron-forward' : 'chevron-down'}
                            size={17}
                            color={desktopSurfaces.accent}
                          />
                        </Pressable>
                      ) : <View style={styles.collapseSpacer} />}
                      <View style={styles.nameCopy}>
                        <Text style={[styles.itemName, row.item.isSummary && styles.summaryName]} numberOfLines={1}>
                          {row.item.taskName}
                        </Text>
                        <Text style={styles.itemKind}>
                          {row.item.isSummary ? 'Phase' : row.item.isMilestone ? 'Milestone' : row.item.itemType || 'Task'}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.cell, styles.areaColumn]} numberOfLines={1}>{row.item.locationName || '—'}</Text>
                    <Text style={[styles.cell, styles.dateColumn]}>{shortDate(row.item.startDate)}</Text>
                    <Text style={[styles.cell, styles.dateColumn]}>{shortDate(row.item.finishDate)}</Text>
                    <Text style={[styles.cell, styles.durationColumn]}>{row.item.durationDays ?? '—'}</Text>
                    <Text style={[styles.cell, styles.predecessorColumn]} numberOfLines={2}>
                      {dependencyLabels.join(', ') || '—'}
                    </Text>
                    <View style={styles.statusColumn}>
                      <View style={[
                        styles.statusPill,
                        row.item.status === 'Complete' && styles.statusPillComplete,
                        row.item.status === 'In Progress' && styles.statusPillProgress,
                      ]}>
                        <Text style={styles.statusText}>{row.item.status}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
      ) : workspaceView === 'gantt' ? (
        <GanttWorkspace
          tasks={tasks}
          zoom={ganttZoom}
          onZoomChange={setGanttZoom}
          onOpenItem={task => openEdit(task as DAVEWebScheduleItem)}
          impactPendingItemId={impactPendingItemId}
          onApplyImpactItem={itemId => { void applyDependencyDateChange(itemId); }}
          onApplyAllImpactItems={() => { void applyAllDependencyDateChanges(); }}
        />
      ) : (
        <LookaheadWorkspace
          tasks={tasks}
          weeks={lookaheadWeeks}
          onWeeksChange={setLookaheadWeeks}
          onOpenItem={task => openEdit(task as DAVEWebScheduleItem)}
        />
      )}
    </View>
  );
}

function GanttWorkspace({
  tasks,
  zoom,
  onZoomChange,
  onOpenItem,
  impactPendingItemId,
  onApplyImpactItem,
  onApplyAllImpactItems,
}: {
  tasks: readonly DAVEWebScheduleItem[];
  zoom: VitruviusGanttZoom;
  onZoomChange: (zoom: VitruviusGanttZoom) => void;
  onOpenItem: (item: ScheduleItem) => void;
  impactPendingItemId: string | null;
  onApplyImpactItem: (itemId: string) => void;
  onApplyAllImpactItems: () => void;
}) {
  const [showCriticalPath, setShowCriticalPath] = useState(true);
  const [showBaselines, setShowBaselines] = useState(true);
  const [showImpactPreview, setShowImpactPreview] = useState(false);
  const model = useMemo(
    // By building, as the Builder groups (A5 pass 13); the phone keeps the root.
    () => buildVitruviusGanttModel({ items: tasks, zoom, groupBy: 'appProject' }),
    [tasks, zoom],
  );
  const analytics = useMemo(
    () => analyzeVitruviusSchedule(tasks),
    [tasks],
  );
  const criticalIds = analytics.criticalPath.criticalItemIds;
  const lateBaselineCount = analytics.baselineVariance.filter(
    variance => variance.status === 'late',
  ).length;
  const rowHeight = 58;
  const timelineHeight = Math.max(180, model.rows.length * rowHeight);

  return (
    <View style={styles.ganttSurface}>
      <View style={styles.ganttToolbar}>
        <View>
          <Text style={styles.ganttTitle}>Project timeline</Text>
          <Text style={styles.ganttRange}>
            {shortDate(model.rangeStart)} – {shortDate(model.rangeFinish)}
          </Text>
        </View>
        <View style={styles.zoomToggle}>
          {(['day', 'week', 'month'] as VitruviusGanttZoom[]).map(option => (
            <Pressable
              key={option}
              style={[styles.zoomButton, zoom === option && styles.zoomButtonSelected]}
              onPress={() => onZoomChange(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: zoom === option }}
            >
              <Text style={[
                styles.zoomButtonText,
                zoom === option && styles.zoomButtonTextSelected,
              ]}>
                {capitalize(option)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.scheduleControlBar}>
        <ScheduleControl
          label={analytics.criticalPath.available
            ? `Critical path (${criticalIds.size})`
            : 'Critical path (not calculated)'}
          selected={showCriticalPath}
          onPress={() => setShowCriticalPath(value => !value)}
          disabled={!analytics.criticalPath.available}
        />
        <ScheduleControl
          label={`Baselines (${analytics.baselineVariance.filter(
            variance => variance.status !== 'no_baseline',
          ).length})`}
          selected={showBaselines}
          onPress={() => setShowBaselines(value => !value)}
        />
        <ScheduleControl
          label={`Impact preview (${analytics.impactPreview.changes.length})`}
          selected={showImpactPreview}
          onPress={() => setShowImpactPreview(value => !value)}
        />
        <View style={styles.controlSummary}>
          <Text style={[
            styles.controlSummaryText,
            lateBaselineCount > 0 && styles.controlSummaryTextLate,
          ]}>
            {lateBaselineCount > 0
              ? `${lateBaselineCount} late against baseline`
              : 'No baseline delay identified'}
          </Text>
        </View>
      </View>

      {!analytics.criticalPath.safe ? (
        <View style={styles.criticalPathWarning} accessibilityRole="alert">
          <Ionicons name="warning-outline" size={19} color="#8B2B24" />
          <View style={styles.criticalPathWarningCopy}>
            <Text style={styles.criticalPathWarningTitle}>
              Critical path is unavailable
            </Text>
            <Text style={styles.criticalPathWarningText}>
              Correct the dependency network before relying on critical-path results.
              {' '}{analytics.criticalPath.issues[0] || ''}
            </Text>
          </View>
        </View>
      ) : analytics.criticalPath.available ? null : (
        <View style={styles.criticalPathNotice}>
          <Ionicons name="git-branch-outline" size={19} color={desktopSurfaces.accentText} />
          <View style={styles.criticalPathWarningCopy}>
            <Text style={styles.criticalPathNoticeTitle}>
              Critical path not calculated
            </Text>
            <Text style={styles.criticalPathNoticeText}>
              Add finish-to-start relationships between schedule tasks to calculate a critical path.
            </Text>
          </View>
        </View>
      )}

      {model.rows.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="bar-chart-outline" size={30} color={desktopSurfaces.accent} />
          <Text style={styles.emptyTitle}>No work is ready for the timeline</Text>
          <Text style={styles.emptyText}>Create a task or milestone to begin the Gantt schedule.</Text>
        </View>
      ) : (
        <View style={styles.ganttSplit}>
          <View style={styles.ganttActivityPane}>
            <View style={styles.ganttActivityHeader}>
              <Text style={styles.ganttHeaderText}>ACTIVITY</Text>
              <Text style={styles.ganttHeaderText}>DATES</Text>
            </View>
            {model.rows.map((row, index) => {
              const previousProject = model.rows[index - 1]?.projectName;
              return (
                <Pressable
                  key={row.item.id}
                  style={[
                    styles.ganttActivityRow,
                    index % 2 === 1 && styles.ganttRowAlternate,
                    row.summary && styles.ganttSummaryRow,
                  ]}
                  onPress={() => onOpenItem(row.item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open timeline item ${row.item.taskName}`}
                >
                  <View style={[styles.ganttActivityCopy, { paddingLeft: row.depth * 18 }]}>
                    {row.projectName !== previousProject ? (
                      <Text style={styles.ganttProjectLabel} numberOfLines={1}>
                        {row.projectName}
                      </Text>
                    ) : null}
                    <Text
                      style={[styles.ganttItemName, row.summary && styles.ganttSummaryName]}
                      numberOfLines={1}
                    >
                      {row.item.wbsCode ? `${row.item.wbsCode}  ` : ''}{row.item.taskName}
                    </Text>
                    {showCriticalPath && criticalIds.has(row.item.id) ? (
                      <Text style={styles.ganttCriticalLabel}>CRITICAL</Text>
                    ) : null}
                  </View>
                  <Text style={styles.ganttDateText} numberOfLines={1}>
                    {row.startDate && row.finishDate
                      ? `${shortDate(row.startDate)} – ${shortDate(row.finishDate)}`
                      : 'Set dates'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            style={styles.ganttTimelineScroll}
            contentContainerStyle={{ width: model.timelineWidth }}
          >
            <View style={{ width: model.timelineWidth }}>
              <View style={styles.ganttTimelineHeader}>
                {model.columns.map(column => (
                  <View
                    key={column.key}
                    style={[
                      styles.ganttColumnHeader,
                      { left: column.left, width: column.width },
                    ]}
                  >
                    <Text style={styles.ganttColumnLabel} numberOfLines={1}>
                      {column.label}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={[styles.ganttTimelineCanvas, { height: timelineHeight }]}>
                {model.columns.map(column => (
                  <View
                    key={`grid:${column.key}`}
                    style={[
                      styles.ganttGridColumn,
                      { left: column.left, width: column.width },
                    ]}
                  />
                ))}
                {model.todayLeft !== null ? (
                  <View style={[styles.ganttTodayLine, { left: model.todayLeft }]}>
                    <Text style={styles.ganttTodayLabel}>TODAY</Text>
                  </View>
                ) : null}
                {model.rows.map((row, index) => (
                  <View
                    key={row.item.id}
                    style={[
                      styles.ganttTimelineRow,
                      {
                        top: index * rowHeight,
                        width: model.timelineWidth,
                        height: rowHeight,
                      },
                      index % 2 === 1 && styles.ganttTimelineRowAlternate,
                    ]}
                  >
                    {showBaselines &&
                    row.baselineLeft !== null &&
                    row.baselineWidth !== null ? (
                      <View
                        style={[
                          styles.ganttBaselineBar,
                          {
                            left: row.baselineLeft,
                            width: row.baselineWidth,
                            top: 38,
                          },
                        ]}
                      />
                    ) : null}
                    {row.left !== null && row.width !== null ? (
                      row.milestone ? (
                        <View
                          style={[
                            styles.ganttMilestone,
                            { left: row.left, top: 19 },
                          ]}
                        />
                      ) : (
                        <View
                          style={[
                            styles.ganttBar,
                            row.summary && styles.ganttSummaryBar,
                            row.item.status === 'Complete' && styles.ganttCompleteBar,
                            showCriticalPath &&
                            criticalIds.has(row.item.id) &&
                            styles.ganttCriticalBar,
                            { left: row.left, width: row.width, top: row.summary ? 18 : 16 },
                          ]}
                        >
                          {!row.summary && row.progressWidth !== null ? (
                            <View
                              style={[
                                styles.ganttProgressBar,
                                { width: row.progressWidth },
                              ]}
                            />
                          ) : null}
                        </View>
                      )
                    ) : (
                      <Text style={styles.ganttMissingDate}>Set dates to place this item</Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      )}
      {showImpactPreview ? (
        <ImpactPreviewPanel
          analytics={analytics}
          tasks={tasks}
          pendingItemId={impactPendingItemId}
          onApplyItem={onApplyImpactItem}
          onApplyAll={onApplyAllImpactItems}
        />
      ) : null}
    </View>
  );
}

function LookaheadWorkspace({
  tasks,
  weeks,
  onWeeksChange,
  onOpenItem,
}: {
  tasks: readonly DAVEWebScheduleItem[];
  weeks: VitruviusLookaheadWeeks;
  onWeeksChange: (weeks: VitruviusLookaheadWeeks) => void;
  onOpenItem: (item: ScheduleItem) => void;
}) {
  const lookahead = useMemo(
    // By building, as the Builder groups (A5 pass 13); the phone keeps the root.
    () => buildVitruviusLookahead({ items: tasks, weeks, groupBy: 'appProject' }),
    [tasks, weeks],
  );
  const groupedRows = useMemo(
    () => groupLookaheadRows(lookahead.rows),
    [lookahead.rows],
  );
  return (
    <View style={styles.lookaheadSurface}>
      <View style={styles.lookaheadToolbar}>
        <View>
          <Text style={styles.ganttTitle}>{weeks}-week construction lookahead</Text>
          <Text style={styles.ganttRange}>
            {shortDate(lookahead.rangeStart)} – {shortDate(lookahead.rangeFinish)}
          </Text>
        </View>
        <View style={styles.lookaheadActions}>
          <View style={styles.zoomToggle}>
            {([3, 6] as VitruviusLookaheadWeeks[]).map(option => (
              <Pressable
                key={option}
                style={[styles.zoomButton, weeks === option && styles.zoomButtonSelected]}
                onPress={() => onWeeksChange(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: weeks === option }}
              >
                <Text style={[
                  styles.zoomButtonText,
                  weeks === option && styles.zoomButtonTextSelected,
                ]}>
                  {option} Weeks
                </Text>
              </Pressable>
            ))}
          </View>
          <ActionButton
            icon="download-outline"
            label="Export CSV"
            onPress={() => downloadLookaheadCsv(lookahead)}
          />
          <ActionButton
            icon="print-outline"
            label="Print"
            onPress={() => {
              if (typeof window !== 'undefined') window.print();
            }}
          />
        </View>
      </View>

      <View style={styles.lookaheadMetrics}>
        <Metric label="Open in window" value={lookahead.rows.length} icon="calendar-outline" />
        <Metric label="Overdue" value={lookahead.overdueCount} icon="alert-circle-outline" />
        <Metric label="Blocked" value={lookahead.blockedCount} icon="lock-closed-outline" />
        <Metric label="Critical" value={lookahead.criticalCount} icon="pulse-outline" />
        <Metric label="Needs dates" value={lookahead.undatedCount} icon="help-circle-outline" />
      </View>

      {lookahead.rows.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-circle-outline" size={32} color="#3D8A5A" />
          <Text style={styles.emptyTitle}>No open work falls in this lookahead</Text>
          <Text style={styles.emptyText}>Switch to six weeks or add dates to unscheduled work.</Text>
        </View>
      ) : (
        <View style={styles.lookaheadTable}>
          <View style={styles.lookaheadHeader}>
            <Text style={[styles.lookaheadHeaderText, styles.lookaheadWbs]}>WBS</Text>
            <Text style={[styles.lookaheadHeaderText, styles.lookaheadName]}>ACTIVITY</Text>
            <Text style={[styles.lookaheadHeaderText, styles.lookaheadDate]}>START</Text>
            <Text style={[styles.lookaheadHeaderText, styles.lookaheadDate]}>FINISH</Text>
            <Text style={[styles.lookaheadHeaderText, styles.lookaheadContractor]}>CONTRACTOR</Text>
            <Text style={[styles.lookaheadHeaderText, styles.lookaheadStatus]}>READINESS</Text>
          </View>
          {groupedRows.map(project => (
            <View key={project.projectName}>
              <View style={styles.lookaheadProjectHeading}>
                <Text style={styles.lookaheadProjectName}>{project.projectName}</Text>
                <Text style={styles.projectCount}>{project.rows.length} items</Text>
              </View>
              {project.areas.map(area => (
                <View key={`${project.projectName}:${area.areaName}`}>
                  <View style={styles.lookaheadAreaHeading}>
                    <Ionicons name="map-outline" size={15} color={desktopSurfaces.accent} />
                    <Text style={styles.lookaheadAreaName}>{area.areaName}</Text>
                    <Text style={styles.lookaheadAreaCount}>{area.rows.length}</Text>
                  </View>
                  {area.rows.map(row => (
                    <LookaheadRow
                      key={row.item.id}
                      row={row}
                      onPress={() => onOpenItem(row.item)}
                    />
                  ))}
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
      <Text style={styles.lookaheadFootnote}>
        Completed work is excluded. Overdue and undated open work remains visible so it cannot fall out of the coordination plan.
      </Text>
    </View>
  );
}

function LookaheadRow({
  row,
  onPress,
}: {
  row: VitruviusLookaheadItem;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.lookaheadRow,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open lookahead item ${row.item.taskName}`}
    >
      <Text style={[styles.cell, styles.lookaheadWbs]}>{row.item.wbsCode || '—'}</Text>
      <View style={styles.lookaheadName}>
        <View style={styles.lookaheadNameLine}>
          <Text style={styles.lookaheadItemName} numberOfLines={1}>{row.item.taskName}</Text>
          {row.critical ? (
            <View style={styles.criticalBadge}><Text style={styles.criticalBadgeText}>CRITICAL</Text></View>
          ) : null}
        </View>
        <Text style={styles.lookaheadResponsibility} numberOfLines={1}>
          {row.owner}
          {row.blockingPredecessorNames.length > 0
            ? ` · Waiting on ${row.blockingPredecessorNames.join(', ')}`
            : ''}
        </Text>
      </View>
      <Text style={[styles.cell, styles.lookaheadDate]}>{row.startDate ? shortDate(row.startDate) : '—'}</Text>
      <Text style={[styles.cell, styles.lookaheadDate]}>{row.finishDate ? shortDate(row.finishDate) : '—'}</Text>
      <Text style={[styles.cell, styles.lookaheadContractor]} numberOfLines={1}>{row.contractor}</Text>
      <View style={styles.lookaheadStatus}>
        <View style={[
          styles.readinessPill,
          row.status === 'overdue' && styles.readinessOverdue,
          row.status === 'blocked' && styles.readinessBlocked,
          row.status === 'in_progress' && styles.readinessProgress,
          row.status === 'ready' && styles.readinessReady,
        ]}>
          <Text style={styles.readinessText}>{lookaheadStatusLabel(row.status)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function ScheduleControl({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.scheduleControl,
        selected && styles.scheduleControlSelected,
        disabled && styles.scheduleControlDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
    >
      <Ionicons
        name={selected ? 'checkbox' : 'square-outline'}
        size={16}
        color={selected ? desktopSurfaces.onAccent : desktopSurfaces.accent}
      />
      <Text style={[
        styles.scheduleControlText,
        selected && styles.scheduleControlTextSelected,
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ImpactPreviewPanel({
  analytics,
  tasks,
  pendingItemId,
  onApplyItem,
  onApplyAll,
}: {
  analytics: ReturnType<typeof analyzeVitruviusSchedule>;
  tasks: readonly ScheduleItem[];
  pendingItemId: string | null;
  onApplyItem: (itemId: string) => void;
  onApplyAll: () => void;
}) {
  const itemsById = new Map(tasks.map(item => [item.id, item]));
  return (
    <View style={styles.impactPanel}>
      <View style={styles.impactHeading}>
        <View>
          <Text style={styles.impactTitle}>Dependency impact preview</Text>
          <Text style={styles.impactDetail}>
            Review and accept calculated date changes one task at a time.
          </Text>
        </View>
        <View style={styles.impactHeadingActions}>
          {analytics.impactPreview.changes.length > 1 ? (
            <Pressable
              style={[
                styles.impactApplyAllButton,
                (!analytics.impactPreview.safeToApply || pendingItemId !== null) && styles.disabled,
              ]}
              onPress={onApplyAll}
              disabled={!analytics.impactPreview.safeToApply || pendingItemId !== null}
              accessibilityRole="button"
              accessibilityLabel="Apply all calculated dependency date changes"
            >
              {pendingItemId === 'all' ? (
                <ActivityIndicator size="small" color={desktopSurfaces.onAccent} />
              ) : (
                <Text style={styles.impactApplyButtonText}>Apply all changes</Text>
              )}
            </Pressable>
          ) : null}
          <View style={[
            styles.impactSafety,
            !analytics.impactPreview.safeToApply && styles.impactSafetyDanger,
          ]}>
            <Text style={[
              styles.impactSafetyText,
              !analytics.impactPreview.safeToApply && styles.impactSafetyTextDanger,
            ]}>
              {analytics.impactPreview.safeToApply ? 'Safe to review' : 'Needs correction'}
            </Text>
          </View>
        </View>
      </View>
      {analytics.impactPreview.issues.length > 0 ? (
        <View style={styles.impactIssues}>
          {analytics.impactPreview.issues.map((issue, index) => (
            <Text key={`${issue.code}:${issue.itemId}:${index}`} style={styles.impactIssueText}>
              • {issue.message}
            </Text>
          ))}
        </View>
      ) : null}
      {analytics.impactPreview.changes.length === 0 ? (
        <Text style={styles.impactEmpty}>
          {analytics.impactPreview.issues.length > 0
            ? `No other date changes are needed. See the note${analytics.impactPreview.issues.length === 1 ? '' : 's'} above.`
            : 'Current task dates already satisfy the saved finish-to-start relationships.'}
        </Text>
      ) : analytics.impactPreview.changes.map(change => (
        <View key={change.itemId} style={styles.impactChange}>
          <View style={styles.impactChangeCopy}>
            <Text style={styles.impactChangeName}>{change.taskName}</Text>
            <Text style={styles.impactChangeReason}>
              After {change.predecessorItemIds.map(id =>
                itemsById.get(id)?.taskName || id,
              ).join(', ')}
            </Text>
          </View>
          <View style={styles.impactChangeAction}>
            <Text style={styles.impactDates}>
              {shortDate(change.previousStartDate)}–{shortDate(change.previousFinishDate)}
              {'  →  '}
              {shortDate(change.nextStartDate)}–{shortDate(change.nextFinishDate)}
            </Text>
            <Pressable
              style={[
                styles.impactApplyButton,
                (
                  !analytics.impactPreview.safeToApply ||
                  pendingItemId !== null
                ) && styles.disabled,
              ]}
              onPress={() => onApplyItem(change.itemId)}
              disabled={!analytics.impactPreview.safeToApply || pendingItemId !== null}
              accessibilityRole="button"
              accessibilityLabel={`Apply calculated dates for ${change.taskName}`}
            >
              {pendingItemId === change.itemId ? (
                <ActivityIndicator size="small" color={desktopSurfaces.onAccent} />
              ) : (
                <Text style={styles.impactApplyButtonText}>Apply dates</Text>
              )}
            </Pressable>
          </View>
        </View>
      ))}
      {!analytics.criticalPath.safe ? (
        <View style={styles.impactIssues}>
          {analytics.criticalPath.issues.map((issue, index) => (
            <Text key={`${issue}:${index}`} style={styles.impactIssueText}>• {issue}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ViewToggle({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.viewToggleButton, selected && styles.viewToggleButtonSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Ionicons
        name={icon}
        size={17}
        color={selected ? desktopSurfaces.onAccent : desktopSurfaces.accent}
      />
      <Text style={[
        styles.viewToggleText,
        selected && styles.viewToggleTextSelected,
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ScheduleEditor({
  state,
  editingTask,
  projects,
  projectTasks,
  linksElsewhere = [],
  predecessorsElsewhere = [],
  openedPredecessorIds = [],
  missingPredecessorIds = [],
  scenario,
  pending,
  awaitingConflictChoice = false,
  onChange,
  onCancel,
  onSave,
}: {
  state: ScheduleEditorState;
  editingTask: DAVEWebScheduleItem | null;
  projects: readonly string[];
  projectTasks: readonly DAVEWebScheduleItem[];
  /** The task's parent and predecessors in another building under the same root (A5 pass 13 L1). */
  linksElsewhere?: readonly DAVEWebScheduleItem[];
  /**
   * The item's predecessors that are in the schedule shown but in neither list above: filed outside the project
   * chosen at the top, or in another project (review pass 1, web M1). `id` is the id the link names; `circular`,
   * that the task also comes after this item.
   */
  predecessorsElsewhere?: readonly Readonly<{ id: string; item: ScheduleItem; circular: boolean }>[];
  /** The predecessors the item had when the editor opened, as the rows shown (WS1 item 7). */
  openedPredecessorIds?: readonly string[];
  /** Predecessors the item still names that are no task shown now (WS1 item 8). */
  missingPredecessorIds?: readonly string[];
  scenario: VitruviusScheduleChangeScenario | null;
  pending: boolean;
  /** Another device's newer version is waiting for Load Latest or Apply My Changes. */
  awaitingConflictChoice?: boolean;
  onChange: (value: ScheduleEditorState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  // The building's own choices, then the task's existing links in another
  // building under its root, labelled with that building (A5 pass 13 L1).
  const parentOptions = [
    ...scheduleParentOptions(editingTask?.id || null, projectTasks),
    ...linksElsewhere.filter(item => item.id === editingTask?.parentItemId?.trim()),
  ];
  const eligiblePredecessors = schedulePredecessorOptions(editingTask?.id || null, projectTasks);
  // Open item, web batch WS1 item 7 (6 Oct 2026): a task that already comes after this item is not offered as a
  // predecessor, so that one editor cannot make a circle. But two links made in opposite directions from two places
  // are both saved, and then each task is the other's predecessor AND comes after it: neither editor listed the
  // other, so he could not untick the link, and Save stayed "Correct Schedule Issues". A predecessor the item
  // already has is always listed, so it can always be removed; and so is one he has ticked in this form that the
  // schedule, refreshed under the open editor, now shows coming after the item (the other link was just made
  // elsewhere): it had dropped out of the list while still ticked.
  const notOffered = editingTask
    ? projectTasks.filter(item =>
        item.id !== editingTask.id &&
        (openedPredecessorIds.includes(item.id) || state.predecessorItemIds.includes(item.id)) &&
        !eligiblePredecessors.some(option => option.id === item.id))
    : [];
  // Review pass 1, web L4 (6 Oct 2026; caused by WS1 item 7): every one of those was labelled "(circular link)",
  // with the line "... is set to finish before this item and also to start after it. That is a circle ...". The
  // editor does not offer two kinds of task: one that comes after the item (a circle if it is also a predecessor),
  // and a phase. A task that starts after a phase is in no circle. Only a task that comes after the item is called
  // a circle now; a phase is called a phase, with its own line.
  const comesAfter = editingTask ? scheduleSuccessorIds(editingTask.id, projectTasks) : new Set<string>();
  const circlePredecessors = notOffered.filter(item => comesAfter.has(item.id));
  const predecessorOptions = [
    ...eligiblePredecessors,
    ...linksElsewhere.filter(item =>
      (editingTask?.dependencies || []).some(dependency => dependency.predecessorItemId === item.id),
    ),
    ...notOffered,
  ];
  const inCircle = (item: ScheduleItem) => circlePredecessors.some(link => link.id === item.id);
  /** A predecessor that is a phase, and in no circle (L4). */
  const isPhaseLink = (item: ScheduleItem) => item.isSummary === true && !inCircle(item);
  const buildingLabel = (item: ScheduleItem) =>
    inCircle(item) ? ' (circular link)'
      : linksElsewhere.some(link => link.id === item.id) ? ` (${taskProjectName(item)})` : '';
  /** What follows a predecessor's name in the list: a circle, a phase (with its building when it is in another), or its building. */
  const predecessorLabel = (item: ScheduleItem) => {
    if (!isPhaseLink(item)) return buildingLabel(item);
    const building = linksElsewhere.some(link => link.id === item.id) ? taskProjectName(item) : '';
    return ` (a phase${building ? `, ${building}` : ''})`;
  };
  // A circle through a task filed under another schedule name is a circle all the same (M1): named with the others,
  // and it holds the save while it is ticked. The calculation holds the save for a circle within the item's own
  // schedule; it takes a task filed elsewhere on the dates it has, and so cannot see a circle through one.
  const circlesElsewhere = predecessorsElsewhere.filter(link => link.circular);
  const circleNames = [...circlePredecessors, ...circlesElsewhere.map(link => link.item)].map(item => `“${item.taskName}”`);
  // (Not for a phase: its predecessors are not in its form, and its save keeps them as stored.)
  const circleTicked = state.kind !== 'phase' && (
    circlePredecessors.some(item => state.predecessorItemIds.includes(item.id)) ||
    circlesElsewhere.some(link => state.predecessorItemIds.includes(link.id)));
  /** Where a predecessor outside the editor's lists is filed: its project, or its schedule's name in this project. */
  const filedUnder = (item: ScheduleItem) =>
    normalize(taskProjectName(item)) === normalize(state.projectName)
      ? item.scheduleProjectName?.trim() || taskProjectName(item)
      : taskProjectName(item);
  // The phases this item is ticked to start after, wherever they are listed (L4), for the line that names them. The
  // web's schedule places an item after tasks and milestones only (its critical path leaves phases out), so the
  // calculation holds the save while one is ticked: what the line says.
  const phasesTicked = [
    ...predecessorOptions.filter(item => isPhaseLink(item) && state.predecessorItemIds.includes(item.id)),
    ...predecessorsElsewhere.filter(link => link.item.isSummary === true && !link.circular && state.predecessorItemIds.includes(link.id)).map(link => link.item),
  ];
  const areaOptions = uniqueText(projectTasks.map(item => item.locationName));
  const canCaptureBaseline = Boolean(
    state.startDate.trim() &&
    (state.kind === 'milestone' || state.finishDate.trim()),
  );
  const scheduleIssues = Boolean(
    editingTask &&
    ((scenario && !scenario.safety.safeToApply) || circleTicked),
  );
  const saveBlocked = pending || awaitingConflictChoice || scheduleIssues;
  const update = <K extends keyof ScheduleEditorState>(
    key: K,
    value: ScheduleEditorState[K],
  ) => onChange({ ...state, [key]: value });

  return (
    <View style={styles.editor}>
      <View style={styles.editorHeading}>
        <View>
          <Text style={styles.editorEyebrow}>{state.kind.toUpperCase()}</Text>
          <Text style={styles.editorTitle}>{editingTask ? 'Edit schedule item' : `Add ${state.kind}`}</Text>
        </View>
        <Pressable style={styles.closeButton} onPress={onCancel} accessibilityRole="button">
          <Ionicons name="close" size={22} color={desktopSurfaces.text} />
        </Pressable>
      </View>

      <View style={styles.formGrid}>
        <EditorField label="Name" value={state.taskName} onChange={value => update('taskName', value)} wide />
        <ChoiceField
          label="Project"
          value={state.projectName}
          options={projects}
          onChange={value => update('projectName', value)}
          disabled={Boolean(editingTask)}
          wide
        />
        <EditorField label="WBS" value={state.wbsCode} onChange={value => update('wbsCode', value)} />
        <ChoiceField
          label="Parent phase"
          value={state.parentItemId}
          options={parentOptions.map(item => item.id)}
          optionLabel={value => {
            const parent = parentOptions.find(item => item.id === value);
            return parent ? `${parent.taskName}${buildingLabel(parent)}` : value;
          }}
          onChange={value => update('parentItemId', value)}
          allowNone
        />
        <AreaCombobox
          value={state.locationName}
          options={areaOptions}
          onChange={value => update('locationName', value)}
        />
        <EditorField label="Owner" value={state.owner} onChange={value => update('owner', value)} />
        {state.kind !== 'phase' ? (
          <>
            <DateField label={state.kind === 'milestone' ? 'Milestone date' : 'Start date'} value={state.startDate} onChange={value => update('startDate', value)} />
            {state.kind !== 'milestone' ? (
              <DateField label="Finish date" value={state.finishDate} onChange={value => update('finishDate', value)} />
            ) : <View style={styles.formField} />}
            {state.kind !== 'milestone' ? (
              <EditorField label="Duration (working days)" value={state.durationDays} onChange={value => update('durationDays', value)} numeric />
            ) : null}
            <EditorField label="Lag after predecessors" value={state.lagDays} onChange={value => update('lagDays', value)} numeric />
          </>
        ) : null}
      </View>

      {state.kind !== 'phase' ? (
        <View style={styles.baselineSection}>
          <View style={styles.baselineHeading}>
            <View>
              <Text style={styles.fieldLabel}>Baseline dates</Text>
              <Text style={styles.helpText}>
                Preserve the approved plan so future movement is visible.
              </Text>
            </View>
            <Pressable
              style={[
                styles.baselineCaptureButton,
                !canCaptureBaseline && styles.disabled,
              ]}
              onPress={() => onChange({
                ...state,
                baselineStartDate: state.startDate,
                baselineFinishDate: state.kind === 'milestone'
                  ? state.startDate
                  : state.finishDate,
              })}
              disabled={!canCaptureBaseline}
              accessibilityRole="button"
              accessibilityLabel="Use current dates as baseline"
            >
              <Ionicons name="flag-outline" size={16} color={desktopSurfaces.accent} />
              <Text style={styles.baselineCaptureText}>Use current dates</Text>
            </Pressable>
          </View>
          <View style={styles.formGrid}>
            <DateField label="Baseline start" value={state.baselineStartDate} onChange={value => update('baselineStartDate', value)} />
            <DateField label="Baseline finish" value={state.baselineFinishDate} onChange={value => update('baselineFinishDate', value)} />
          </View>
        </View>
      ) : null}

      {state.kind !== 'phase' ? (
        <View style={styles.relationshipSection}>
          <Text style={styles.fieldLabel}>Finish-to-start predecessors</Text>
          <Text style={styles.helpText}>Select work that must finish before this item can start.</Text>
          {circleNames.length > 0 ? (
            <Text style={styles.scenarioIssue} accessibilityRole="alert">
              {`${circleNames.join(' and ')} ${circleNames.length === 1 ? 'is' : 'are'} set to finish before this item and also to start after it. That is a circle, and the schedule cannot place it. Untick ${circleNames.length === 1 ? 'it' : 'one'} below, then save.`}
            </Text>
          ) : null}
          {phasesTicked.length > 0 ? (
            <Text style={styles.scenarioIssue} accessibilityRole="alert">
              {`${phasesTicked.map(item => `“${item.taskName}”`).join(' and ')} ${phasesTicked.length === 1 ? 'is a phase' : 'are phases'}, and this schedule can only place an item after tasks and milestones: it cannot place this item while it starts after a phase. Untick ${phasesTicked.length === 1 ? 'it' : 'them'} below, then save. To keep the order, tick the ${phasesTicked.length === 1 ? 'task' : 'tasks'} this item should follow instead.`}
            </Text>
          ) : null}
          {missingPredecessorIds.length > 0 ? (
            <Text style={styles.scenarioIssue} accessibilityRole="alert">
              {`This item is set to start after ${missingPredecessorIds.length === 1 ? 'a task that is' : `${missingPredecessorIds.length} tasks that are`} no longer in the schedule (deleted, or on a schedule that is not the current one). The schedule cannot place it until ${missingPredecessorIds.length === 1 ? 'that link is' : 'those links are'} removed. Untick ${missingPredecessorIds.length === 1 ? 'it' : 'them'} below, then save.`}
            </Text>
          ) : null}
          <View style={styles.choiceWrap}>
            {missingPredecessorIds.map(id => {
              const selected = state.predecessorItemIds.includes(id);
              return (
                <Pressable
                  key={`missing-${id}`}
                  style={[styles.choiceChip, selected && styles.choiceChipSelected]}
                  onPress={() => update(
                    'predecessorItemIds',
                    selected ? state.predecessorItemIds.filter(other => other !== id) : [...state.predecessorItemIds, id],
                  )}
                  accessibilityRole="checkbox"
                  accessibilityLabel="A task no longer in the schedule"
                  accessibilityState={{ checked: selected }}
                >
                  <Ionicons
                    name={selected ? 'checkbox' : 'square-outline'}
                    size={17}
                    color={selected ? desktopSurfaces.onAccent : desktopSurfaces.accent}
                  />
                  <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>A task no longer in the schedule</Text>
                </Pressable>
              );
            })}
            {predecessorOptions.length === 0 ? (
              missingPredecessorIds.length === 0 && predecessorsElsewhere.length === 0
                ? <Text style={styles.helpText}>No eligible predecessor tasks yet.</Text>
                : null
            ) : predecessorOptions.map(item => {
              const selected = state.predecessorItemIds.includes(item.id);
              return (
                <Pressable
                  key={item.id}
                  style={[styles.choiceChip, selected && styles.choiceChipSelected]}
                  onPress={() => update(
                    'predecessorItemIds',
                    selected
                      ? state.predecessorItemIds.filter(id => id !== item.id)
                      : [...state.predecessorItemIds, item.id],
                  )}
                  accessibilityRole="checkbox"
                  {...(inCircle(item) ? { accessibilityLabel: `${item.taskName}, circular link` }
                    : isPhaseLink(item) ? { accessibilityLabel: `${item.taskName}, a phase` } : {})}
                  accessibilityState={{ checked: selected }}
                >
                  <Ionicons
                    name={selected ? 'checkbox' : 'square-outline'}
                    size={17}
                    color={selected ? desktopSurfaces.onAccent : desktopSurfaces.accent}
                  />
                  <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>
                    {item.wbsCode ? `${item.wbsCode} · ` : ''}{item.taskName}{predecessorLabel(item)}
                  </Text>
                </Pressable>
              );
            })}
            {predecessorsElsewhere.map(({ id, item, circular }) => {
              // In the schedule, outside these lists (M1): by name, with where it is filed. Ticked by the id the link names.
              const selected = state.predecessorItemIds.includes(id);
              const phase = item.isSummary === true && !circular; // a phase is called a phase here too (L4)
              return (
                <Pressable
                  key={`elsewhere-${id}`}
                  style={[styles.choiceChip, selected && styles.choiceChipSelected]}
                  onPress={() => update(
                    'predecessorItemIds',
                    selected ? state.predecessorItemIds.filter(other => other !== id) : [...state.predecessorItemIds, id],
                  )}
                  accessibilityRole="checkbox"
                  {...(circular ? { accessibilityLabel: `${item.taskName}, circular link` }
                    : phase ? { accessibilityLabel: `${item.taskName}, a phase` } : {})}
                  accessibilityState={{ checked: selected }}
                >
                  <Ionicons
                    name={selected ? 'checkbox' : 'square-outline'}
                    size={17}
                    color={selected ? desktopSurfaces.onAccent : desktopSurfaces.accent}
                  />
                  <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>
                    {item.wbsCode ? `${item.wbsCode} · ` : ''}{item.taskName}{circular ? ' (circular link)' : ` (${phase ? 'a phase, ' : ''}${filedUnder(item)})`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.formGrid}>
        <EditorField label="Contractor" value={state.contractor} onChange={value => update('contractor', value)} />
        <EditorField
          label="Percent complete"
          value={state.percentComplete}
          // He typed it: his own entry, also when it is the percent a schedule file gave (WS1 item 5).
          onChange={value => onChange({ ...state, percentComplete: value, percentEntered: Boolean(value.trim()) })}
          numeric
        />
      </View>
      <View style={styles.relationshipSection}>
        <Text style={styles.fieldLabel}>Status</Text>
        <View style={styles.choiceWrap} accessibilityRole="radiogroup" accessibilityLabel="Status">
          {(['Not Started', 'In Progress', 'Waiting', 'Complete'] as ScheduleStatus[]).map(status => (
            <Pressable
              key={status}
              style={[styles.choiceChip, state.status === status && styles.choiceChipSelected]}
              onPress={() => update('status', status)}
              accessibilityRole="radio"
              accessibilityState={{ checked: state.status === status }}
            >
              <Text style={[styles.choiceChipText, state.status === status && styles.choiceChipTextSelected]}>{status}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.formField}>
        <Text style={styles.fieldLabel}>Planning notes</Text>
        <TextInput
          value={state.notes}
          onChangeText={value => update('notes', value)}
          multiline
          numberOfLines={3}
          style={[styles.input, styles.notesInput]}
          placeholder="Optional schedule note"
          placeholderTextColor="#7D8794"
          accessibilityLabel="Planning notes"
        />
      </View>
      {editingTask && scenario ? (
        <View style={[
          styles.scenarioPreview,
          !scenario.safety.safeToApply && styles.scenarioPreviewDanger,
        ]}>
          <View style={styles.scenarioHeading}>
            <View>
              <Text style={styles.fieldLabel}>Change impact preview</Text>
              <Text style={styles.helpText}>
                Review the likely plan effect before saving this task.
              </Text>
            </View>
            <Text style={[
              styles.scenarioStatus,
              !scenario.safety.safeToApply && styles.scenarioStatusDanger,
            ]}>
              {scenario.safety.safeToApply ? 'Ready to review' : 'Needs correction'}
            </Text>
          </View>
          <View style={styles.scenarioFacts}>
            <Text style={styles.scenarioFact}>
              {scenario.downstreamChanges.length} downstream task{scenario.downstreamChanges.length === 1 ? '' : 's'} affected
            </Text>
            <Text style={styles.scenarioFact}>
              Project finish: {scenario.projectFinish.after || 'Not calculated'}
              {scenario.projectFinish.deltaCalendarDays
                ? ` (${scenario.projectFinish.deltaCalendarDays > 0 ? '+' : ''}${scenario.projectFinish.deltaCalendarDays} days)`
                : ''}
            </Text>
            <Text style={styles.scenarioFact}>
              Critical path: {scenario.criticalPath.enteredItemIds.length} added, {scenario.criticalPath.exitedItemIds.length} removed
            </Text>
          </View>
          {scenario.safety.issues.slice(0, 3).map(issue => (
            <Text key={`${issue.code}-${issue.itemId || ''}`} style={styles.scenarioIssue}>
              • {issue.message}
            </Text>
          ))}
          {scenario.downstreamChanges.slice(0, 3).map(change => (
            <Text key={change.itemId} style={styles.scenarioChange}>
              {change.taskName}: {shortDate(change.previousStartDate)} → {shortDate(change.nextStartDate)}
            </Text>
          ))}
          <Text style={styles.helpText}>
            Saving changes this task only. Review calculated downstream dates in Gantt → Impact Preview before applying them.
          </Text>
        </View>
      ) : null}
      <View style={styles.editorActions}>
        <Pressable style={styles.secondaryButton} onPress={onCancel} disabled={pending}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryButton, saveBlocked && styles.disabled]}
          onPress={onSave}
          disabled={saveBlocked}
        >
          {pending ? <ActivityIndicator color={desktopSurfaces.onAccent} /> : (
            <Text style={styles.primaryButtonText}>
              {awaitingConflictChoice
                ? 'Choose a Version Above'
                : scheduleIssues
                  ? 'Correct Schedule Issues'
                  : editingTask
                    ? 'Save Changes'
                    : `Create ${capitalize(state.kind)}`}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function EditorField({
  label,
  value,
  onChange,
  numeric = false,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  wide?: boolean;
}) {
  return (
    <View style={[styles.formField, wide && styles.formFieldWide]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {/* Named by its label, as the date, area and list boxes are (independent review F03). */}
      <TextInput
        value={value}
        onChangeText={onChange}
        inputMode={numeric ? 'numeric' : 'text'}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

function ChoiceField({
  label,
  value,
  options,
  optionLabel = candidate => candidate,
  onChange,
  allowNone = false,
  disabled = false,
  wide = false,
}: {
  label: string;
  value: string;
  options: readonly string[];
  optionLabel?: (value: string) => string;
  onChange: (value: string) => void;
  allowNone?: boolean;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <View style={[styles.formField, wide && styles.formFieldWide]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {createElement('select' as never, {
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        style: webSelectStyle,
        disabled,
        'aria-label': label,
        children: [
          ...(allowNone ? [createElement('option' as never, { key: 'none', value: '' }, 'No parent phase')] : []),
          ...options.map(option => createElement(
            'option' as never,
            { key: option, value: option },
            optionLabel(option),
          )),
        ],
      })}
      {disabled ? (
        <Text style={styles.helpText}>
          Project cannot be changed while editing because dependencies are project-specific.
        </Text>
      ) : null}
    </View>
  );
}

function AreaCombobox({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  const listId = 'vitruvius-schedule-area-options';
  return (
    <View style={styles.formField}>
      <Text style={styles.fieldLabel}>Area</Text>
      {createElement('input' as never, {
        type: 'text',
        list: listId,
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        style: webInputStyle,
        'aria-label': 'Area',
        placeholder: 'Choose an existing area or type a new one',
      })}
      {createElement('datalist' as never, {
        id: listId,
        children: options.map(option => createElement(
          'option' as never,
          { key: option, value: option },
        )),
      })}
      <Text style={styles.helpText}>Choose an existing project area or type a new area.</Text>
    </View>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.formField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {createElement('input' as never, {
        type: 'date',
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        style: webInputStyle,
        'aria-label': label,
      })}
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  primary = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      style={[styles.actionButton, primary && styles.actionButtonPrimary]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={18} color={primary ? desktopSurfaces.onAccent : desktopSurfaces.accent} />
      <Text style={[styles.actionButtonText, primary && styles.actionButtonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: number;
}) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricIcon}><Ionicons name={icon} size={20} color={desktopSurfaces.accent} /></View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function groupLookaheadRows(rows: readonly VitruviusLookaheadItem[]) {
  const projects = new Map<string, Map<string, VitruviusLookaheadItem[]>>();
  rows.forEach(row => {
    let areas = projects.get(row.projectName);
    if (!areas) {
      areas = new Map();
      projects.set(row.projectName, areas);
    }
    const areaRows = areas.get(row.areaName);
    if (areaRows) areaRows.push(row);
    else areas.set(row.areaName, [row]);
  });
  return [...projects.entries()].map(([projectName, areas]) => ({
    projectName,
    rows: [...areas.values()].flat(),
    areas: [...areas.entries()].map(([areaName, areaRows]) => ({
      areaName,
      rows: areaRows,
    })),
  }));
}

function downloadLookaheadCsv(
  lookahead: ReturnType<typeof buildVitruviusLookahead>,
) {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof Blob === 'undefined'
  ) return;
  const url = URL.createObjectURL(new Blob(
    [vitruviusLookaheadCsv(lookahead)],
    { type: 'text/csv;charset=utf-8' },
  ));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `vitruvius-${lookahead.weeks}-week-lookahead-${lookahead.rangeStart}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadScheduleCalendar(tasks: readonly ScheduleItem[]) {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof Blob === 'undefined'
  ) return;
  const calendar = buildVitruviusCalendarExport(tasks);
  if (calendar.eventCount === 0) return;
  const url = URL.createObjectURL(new Blob(
    [calendar.content],
    { type: 'text/calendar;charset=utf-8' },
  ));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'vitruvius-project-schedule.ics';
  anchor.click();
  URL.revokeObjectURL(url);
}

function ancestorIsCollapsed(
  item: ScheduleItem,
  projectTasks: readonly ScheduleItem[],
  collapsedIds: ReadonlySet<string>,
) {
  let parentId = item.parentItemId?.trim();
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    if (collapsedIds.has(parentId)) return true;
    visited.add(parentId);
    parentId = projectTasks.find(candidate => candidate.id === parentId)?.parentItemId?.trim();
  }
  return false;
}

/**
 * The task the schedule shows for a predecessor id, wherever it is filed, or null: the link is then to a task that
 * is no longer in the schedule (review pass 1, web M1). A link that names an earlier row of the task itself is no
 * predecessor.
 */
function livePredecessor(
  linkTarget: (predecessorId: string) => ScheduleItem | null,
  predecessorId: string,
  taskId: string | null,
): ScheduleItem | null {
  const target = linkTarget(predecessorId);
  return target && target.id !== taskId ? target : null;
}

/** The task shown a link names, in the task's project or under its root (owner answer Q29). */
function shownLinkTarget(
  linkTarget: (predecessorId: string) => ScheduleItem | null,
  predecessorId: string,
  task: ScheduleItem,
): ScheduleItem | undefined {
  const target = linkTarget(predecessorId);
  return target && (taskProjectName(target) === taskProjectName(task) || sameRoot(target, task)) ? target : undefined;
}

function scheduleEditorStateFor(
  task: DAVEWebScheduleItem,
  /** A link to a hidden row is the row shown for its task (owner answer Q29). */
  linkTarget?: (predecessorId: string) => ScheduleItem | null,
): ScheduleEditorState {
  const dependencyLag = task.dependencies?.[0]?.lagDays ?? 0;
  return {
    kind: task.isSummary ? 'phase' : task.isMilestone ? 'milestone' : 'task',
    taskName: task.taskName,
    projectName: taskProjectName(task),
    locationName: task.locationName,
    wbsCode: task.wbsCode || '',
    parentItemId: task.parentItemId || '',
    startDate: dateInputValue(task.startDate),
    finishDate: dateInputValue(task.finishDate),
    baselineStartDate: dateInputValue(task.baselineStartDate || ''),
    baselineFinishDate: dateInputValue(task.baselineFinishDate || ''),
    durationDays: task.durationDays === null || task.durationDays === undefined
      ? ''
      : String(task.durationDays),
    predecessorItemIds: [...new Set((task.dependencies || []).map(dependency => {
      const shown = linkTarget && shownLinkTarget(linkTarget, dependency.predecessorItemId, task);
      return shown && shown.id !== task.id ? shown.id : dependency.predecessorItemId;
    }))],
    lagDays: String(dependencyLag),
    owner: task.owner,
    contractor: task.contractor,
    percentComplete: String(task.percentComplete),
    status: task.status,
    notes: task.notes,
  };
}

/**
 * The milestone text a builder save keeps (whole-app audit round 2 F5,
 * 30 Sep 2026). A save cleared it on every item not marked as a milestone,
 * so an imported milestone (its text set, the flag not) lost it on any edit,
 * and a marked milestone had its text replaced by its name. It follows the
 * name only for a new milestone, or when the owner renames a milestone whose
 * text was its name (or empty); otherwise the existing text stays.
 */
function scheduleBuilderMilestoneText(
  editor: ScheduleEditorState,
  editingTask: DAVEWebScheduleItem | null,
): string {
  const existing = editingTask?.milestone ?? '';
  if (editor.kind !== 'milestone') return existing;
  if (!editingTask || !existing.trim()) return editor.taskName;
  const renamed = editor.taskName.trim() !== editingTask.taskName.trim();
  return renamed && existing.trim() === editingTask.taskName.trim()
    ? editor.taskName
    : existing;
}

/** The dates a task already has, which set the format its saved dates take. */
function scheduleDatesOf(task: ScheduleItem | null): string[] {
  return task
    ? [task.startDate, task.finishDate, task.baselineStartDate || '', task.baselineFinishDate || '']
    : [];
}

/** Calculated dates (2026-10-12) written as the task stores dates (A12 pass 3 M2). */
function calculatedDatesAsStored(
  current: ScheduleItem,
  calculated: Pick<ScheduleItem, 'startDate' | 'finishDate'>,
) {
  return {
    startDate: daveWebScheduleDateForSave(calculated.startDate, current.startDate, scheduleDatesOf(current)),
    finishDate: daveWebScheduleDateForSave(calculated.finishDate, current.finishDate, scheduleDatesOf(current)),
  };
}

/**
 * The date input's 2026-10-05 for a stored date. 10/05/2026 and Oct 5, 2026
 * are read as calendar days: through toISOString they became the day before
 * in any time zone east of UTC. The same reading as the same-day check
 * (whole-app audit A12 pass 4 L1, 30 Sep 2026): the browser's own parser
 * showed days the check did not recognise, so a save rewrote them, and it
 * reads "Week 41" as 1 Jan 2041. Text that names no day ("TBD") shows an
 * empty box and is kept as stored unless he picks a date.
 */
function dateInputValue(value: string | null | undefined) {
  return scheduleCalendarDay(value) ?? '';
}

/**
 * Why the editor's duration, lag or dates cannot be saved, in a plain
 * sentence, or null (independent review R08). A date box left showing the
 * stored day is not judged; a milestone has no duration box.
 */
function scheduleEditorLimitProblem(
  form: ScheduleEditorState,
  opened: DAVEWebScheduleItem | null,
): string | null {
  const dateBoxes: ReadonlyArray<readonly [string, string, string | null | undefined]> = [
    [form.kind === 'milestone' ? 'Milestone date' : 'Start date', form.startDate, opened?.startDate],
    ...(form.kind === 'milestone' ? [] : [['Finish date', form.finishDate, opened?.finishDate] as const]),
    ['Baseline start', form.baselineStartDate, opened?.baselineStartDate],
    ...(form.kind === 'milestone' ? [] : [['Baseline finish', form.baselineFinishDate, opened?.baselineFinishDate] as const]),
  ];
  for (const [label, value, stored] of dateBoxes) {
    const text = value.trim();
    if (!text || (opened && text === dateInputValue(stored))) continue;
    const day = scheduleCalendarDay(text);
    if (!day || !scheduleDayIsSupported(day)) return scheduleDateRangeText(label);
  }
  return (form.kind === 'milestone' ? null : scheduleDurationBoxProblem(form.durationDays)) ||
    scheduleLagBoxProblem(form.lagDays);
}

function shortDate(value: string) {
  const normalizedValue = dateInputValue(value);
  if (!normalizedValue) return '—';
  const [year, month, day] = normalizedValue.split('-');
  return `${month}/${day}/${year?.slice(-2)}`;
}

function numberOrZero(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

/**
 * The project a task is grouped, numbered and edited under: its app project
 * (projectName), the schedule's root (scheduleProjectName) only when it names
 * none, as scheduleTaskProjectKey keys the merge, the delete and the shown
 * schedule. Whole-app audit A5 pass 12 K1 (1 Oct 2026): a combined Microsoft
 * Project master keeps its root ("2400 Compliance Project") as every row's
 * schedule project, so the Schedule page put Harbor North's and Harbor
 * South's tasks under one root heading, the twin Install HVAC rows side by
 * side with nothing to tell them apart, and offered either building's phases
 * and predecessors to the other. Each building's tasks now show under it. A
 * CSV master's rows name the same project both ways.
 */
function taskProjectName(task: Pick<ScheduleItem, 'projectName' | 'scheduleProjectName'>): string {
  return task.projectName || task.scheduleProjectName || '';
}

function inProject(task: Pick<ScheduleItem, 'projectName' | 'scheduleProjectName'>, projectName: string): boolean {
  return normalize(taskProjectName(task)) === normalize(projectName);
}

function sameRoot(left: ScheduleItem, right: ScheduleItem): boolean {
  return Boolean(normalize(left.scheduleProjectName)) && normalize(left.scheduleProjectName) === normalize(right.scheduleProjectName);
}

/**
 * A building's rows, a parent phase in another building under the same root
 * counted as present. Whole-app audit A5 pass 13 L1 (1 Oct 2026): a phase
 * added under a combined master's root while the page grouped by root holds
 * North's and South's tasks; grouped by building, its children showed as
 * orphan rows with "1 hierarchy issue need review." in each building. A
 * parent that is missing, or under another root, is still an issue.
 */
function buildingScheduleHierarchy(buildingTasks: readonly ScheduleItem[], allTasks: readonly ScheduleItem[]) {
  const hierarchy = buildVitruviusScheduleHierarchy(buildingTasks);
  const parentUnderSameRoot = (itemId: string) => {
    const item = buildingTasks.find(candidate => candidate.id === itemId);
    const parentId = item?.parentItemId?.trim();
    return Boolean(item && parentId && allTasks.some(task => task.id === parentId && sameRoot(task, item)));
  };
  return {
    rows: hierarchy.rows.map(row => row.orphaned && parentUnderSameRoot(row.item.id) ? { ...row, orphaned: false } : row),
    issues: hierarchy.issues.filter(issue => issue.code !== 'missing_parent' || !parentUnderSameRoot(issue.itemId)),
  };
}

function uniqueText(values: readonly (string | null | undefined)[]) {
  const result = new Map<string, string>();
  values.forEach(value => {
    const text = value?.trim();
    if (text && !result.has(normalize(text))) result.set(normalize(text), text);
  });
  return [...result.values()];
}

function normalize(value: string | null | undefined) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

const webInputStyle = {
  width: '100%',
  minHeight: 46,
  boxSizing: 'border-box',
  border: `1px solid ${desktopSurfaces.border}`,
  borderRadius: 10,
  background: desktopSurfaces.input,
  color: desktopSurfaces.text,
  fontSize: 15,
  padding: '0 12px',
};

const webSelectStyle = {
  ...webInputStyle,
  appearance: 'auto',
};

const styles = StyleSheet.create({
  workspace: { gap: spacing.lg },
  commandBar: { borderRadius: 18, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.sectionStrong, padding: spacing.lg, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, boxShadow: desktopSurfaces.shadow },
  commandCopy: { flex: 1, minWidth: 280, gap: 3 },
  commandTitle: { color: desktopSurfaces.text, fontSize: 23, lineHeight: 29, fontWeight: '900' },
  commandDetail: { color: desktopSurfaces.textMuted, fontSize: 14, lineHeight: 20, maxWidth: 720 },
  commandActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  viewToggle: { minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, padding: 3, flexDirection: 'row', alignItems: 'center' },
  viewToggleButton: { minHeight: 36, borderRadius: 8, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  viewToggleButtonSelected: { backgroundColor: desktopSurfaces.accent },
  viewToggleText: { color: desktopSurfaces.accentText, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  viewToggleTextSelected: { color: desktopSurfaces.onAccent },
  actionButton: { minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  actionButtonPrimary: { backgroundColor: desktopSurfaces.accent, borderColor: desktopSurfaces.accent },
  actionButtonText: { color: desktopSurfaces.accentText, fontSize: 14, lineHeight: 19, fontWeight: '900' },
  actionButtonTextPrimary: { color: desktopSurfaces.onAccent },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metric: { flexGrow: 1, flexBasis: 180, minHeight: 76, borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metricIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: desktopSurfaces.accentSoft, alignItems: 'center', justifyContent: 'center' },
  metricValue: { color: desktopSurfaces.text, fontSize: 23, lineHeight: 28, fontWeight: '900' },
  metricLabel: { color: desktopSurfaces.textMuted, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  notice: { borderRadius: 12, borderWidth: 1, borderColor: '#7CC59A', backgroundColor: '#EFFAF3', padding: spacing.md },
  noticeDanger: { borderColor: '#E5A4A4', backgroundColor: '#FFF1F1' },
  noticeText: { color: '#195B35', fontSize: 14, lineHeight: 20, fontWeight: '700' },
  noticeTextDanger: { color: '#922323' },
  // The Tasks page's conflict card (conflictResolutionCard), so both read alike.
  conflictCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: '#D5A84C', backgroundColor: '#FFF8E8', padding: spacing.lg, gap: spacing.lg },
  conflictCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 320, gap: spacing.xs },
  conflictTitle: { color: '#76510A', fontSize: 18, lineHeight: 24, fontWeight: '900' },
  conflictText: { color: desktopSurfaces.text, fontSize: 14, lineHeight: 20 },
  conflictActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  editor: { borderRadius: 18, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, borderTopWidth: 5, borderTopColor: desktopSurfaces.accent, backgroundColor: desktopSurfaces.card, padding: spacing.xl, gap: spacing.lg, boxShadow: desktopSurfaces.shadowStrong },
  editorHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  editorEyebrow: { color: desktopSurfaces.accentText, fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 1.2 },
  editorTitle: { color: desktopSurfaces.text, fontSize: 24, lineHeight: 30, fontWeight: '900', marginTop: 2 },
  closeButton: { width: 40, height: 40, borderRadius: 11, borderWidth: 1, borderColor: desktopSurfaces.border, alignItems: 'center', justifyContent: 'center' },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  formField: { flexGrow: 1, flexBasis: 230, minWidth: 0, gap: spacing.xs },
  formFieldWide: { flexBasis: 480 },
  fieldLabel: { color: desktopSurfaces.text, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  input: { minHeight: 46, borderWidth: 1, borderColor: desktopSurfaces.border, borderRadius: 10, backgroundColor: desktopSurfaces.input, color: desktopSurfaces.text, fontSize: 15, paddingHorizontal: spacing.md },
  notesInput: { minHeight: 88, paddingTop: spacing.sm, textAlignVertical: 'top' },
  relationshipSection: { gap: spacing.sm },
  baselineSection: { borderRadius: 13, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.cardMuted, padding: spacing.md, gap: spacing.md },
  baselineHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  baselineCaptureButton: { minHeight: 38, borderRadius: 9, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  baselineCaptureText: { color: desktopSurfaces.accentText, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  helpText: { color: desktopSurfaces.textMuted, fontSize: 13, lineHeight: 19 },
  scenarioPreview: { borderRadius: 13, borderWidth: 1, borderColor: '#7CC59A', backgroundColor: '#EFFAF3', padding: spacing.md, gap: spacing.sm },
  scenarioPreviewDanger: { borderColor: '#E5A4A4', backgroundColor: desktopSurfaces.cardRose },
  scenarioHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  scenarioStatus: { borderRadius: 999, backgroundColor: '#DDF2E5', color: '#27603B', fontSize: 11, lineHeight: 16, fontWeight: '900', paddingHorizontal: spacing.sm, paddingVertical: 5 },
  scenarioStatusDanger: { backgroundColor: '#FFE1E1', color: '#8B2B24' },
  scenarioFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  scenarioFact: { borderRadius: 9, backgroundColor: desktopSurfaces.card, color: desktopSurfaces.text, fontSize: 12, lineHeight: 17, fontWeight: '800', paddingHorizontal: spacing.sm, paddingVertical: 7 },
  scenarioIssue: { color: '#8B2B24', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  scenarioChange: { color: desktopSurfaces.accentText, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choiceChip: { minHeight: 40, maxWidth: 360, borderRadius: 999, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.cardMuted, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  choiceChipSelected: { backgroundColor: desktopSurfaces.accent, borderColor: desktopSurfaces.accent },
  choiceChipText: { flexShrink: 1, color: desktopSurfaces.text, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  choiceChipTextSelected: { color: desktopSurfaces.onAccent },
  editorActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: desktopSurfaces.border },
  primaryButton: { minWidth: 180, minHeight: 46, borderRadius: 11, backgroundColor: desktopSurfaces.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryButtonText: { color: desktopSurfaces.onAccent, fontSize: 14, lineHeight: 20, fontWeight: '900' },
  secondaryButton: { minWidth: 100, minHeight: 46, borderRadius: 11, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryButtonText: { color: desktopSurfaces.accentText, fontSize: 14, lineHeight: 20, fontWeight: '900' },
  disabled: { opacity: 0.48 },
  tableSurface: { minWidth: 1040, borderRadius: 16, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, overflow: 'hidden', boxShadow: desktopSurfaces.shadow },
  tableHeader: { minHeight: 44, backgroundColor: desktopSurfaces.dataHeader, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm },
  headerCell: { color: desktopSurfaces.dataHeaderMuted, fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 0.8, paddingHorizontal: spacing.xs },
  projectGroup: { borderTopWidth: 1, borderTopColor: desktopSurfaces.border },
  projectHeading: { minHeight: 48, backgroundColor: desktopSurfaces.sectionStrong, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md },
  projectTitle: { color: desktopSurfaces.text, fontSize: 16, lineHeight: 21, fontWeight: '900' },
  projectCount: { color: desktopSurfaces.accentText, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  hierarchyWarning: { backgroundColor: '#FFF5E1', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  hierarchyWarningText: { color: '#754B08', fontSize: 13, lineHeight: 18, fontWeight: '800' },
  tableRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, paddingHorizontal: spacing.sm },
  summaryRow: { backgroundColor: desktopSurfaces.cardMuted },
  orphanRow: { borderLeftWidth: 4, borderLeftColor: colors.warning },
  rowPressed: { backgroundColor: desktopSurfaces.selected },
  cell: { color: desktopSurfaces.textMuted, fontSize: 12, lineHeight: 17, paddingHorizontal: spacing.xs },
  nameCell: { minHeight: 61, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xs },
  collapseButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  collapseSpacer: { width: 28 },
  nameCopy: { flex: 1, minWidth: 0 },
  itemName: { color: desktopSurfaces.text, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  summaryName: { fontSize: 14 },
  itemKind: { color: desktopSurfaces.textMuted, fontSize: 10, lineHeight: 14, fontWeight: '700', marginTop: 2 },
  statusPill: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: desktopSurfaces.selected, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  statusPillComplete: { backgroundColor: desktopSurfaces.cardGreen },
  statusPillProgress: { backgroundColor: desktopSurfaces.cardAmber },
  statusText: { color: desktopSurfaces.text, fontSize: 11, lineHeight: 15, fontWeight: '900' },
  wbsColumn: { width: 68 },
  nameColumn: { flex: 1, minWidth: 250 },
  areaColumn: { width: 135 },
  dateColumn: { width: 88 },
  durationColumn: { width: 56, textAlign: 'center' },
  predecessorColumn: { width: 150 },
  statusColumn: { width: 112, paddingHorizontal: spacing.xs },
  emptyState: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { color: desktopSurfaces.text, fontSize: 19, lineHeight: 25, fontWeight: '900' },
  emptyText: { color: desktopSurfaces.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  ganttSurface: { minWidth: 900, borderRadius: 16, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, overflow: 'hidden', boxShadow: desktopSurfaces.shadowStrong },
  ganttToolbar: { minHeight: 72, backgroundColor: desktopSurfaces.sectionStrong, borderBottomWidth: 1, borderBottomColor: desktopSurfaces.borderStrong, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  ganttTitle: { color: desktopSurfaces.text, fontSize: 18, lineHeight: 23, fontWeight: '900' },
  ganttRange: { color: desktopSurfaces.textMuted, fontSize: 12, lineHeight: 17, fontWeight: '700', marginTop: 2 },
  zoomToggle: { borderRadius: 10, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, padding: 3, flexDirection: 'row', alignItems: 'center' },
  zoomButton: { minHeight: 34, minWidth: 62, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  zoomButtonSelected: { backgroundColor: desktopSurfaces.accent },
  zoomButtonText: { color: desktopSurfaces.accentText, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  zoomButtonTextSelected: { color: desktopSurfaces.onAccent },
  scheduleControlBar: { minHeight: 54, borderBottomWidth: 1, borderBottomColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.toolbar, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  scheduleControl: { minHeight: 36, borderRadius: 999, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 5 },
  scheduleControlSelected: { borderColor: desktopSurfaces.accent, backgroundColor: desktopSurfaces.accent },
  scheduleControlDisabled: { opacity: 0.58 },
  scheduleControlText: { color: desktopSurfaces.accentText, fontSize: 11, lineHeight: 16, fontWeight: '900' },
  scheduleControlTextSelected: { color: desktopSurfaces.onAccent },
  controlSummary: { marginLeft: 'auto', minHeight: 32, borderRadius: 9, backgroundColor: desktopSurfaces.cardGreen, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  controlSummaryText: { color: '#27603B', fontSize: 11, lineHeight: 16, fontWeight: '900' },
  controlSummaryTextLate: { color: '#8B2B24' },
  criticalPathWarning: { minHeight: 58, borderBottomWidth: 1, borderBottomColor: '#E5A4A4', backgroundColor: desktopSurfaces.cardRose, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  criticalPathWarningCopy: { flex: 1, minWidth: 0 },
  criticalPathWarningTitle: { color: '#8B2B24', fontSize: 13, lineHeight: 18, fontWeight: '900' },
  criticalPathWarningText: { color: '#8B2B24', fontSize: 11, lineHeight: 16, marginTop: 1 },
  criticalPathNotice: { minHeight: 58, borderBottomWidth: 1, borderBottomColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.cardBlue, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  criticalPathNoticeTitle: { color: desktopSurfaces.accentText, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  criticalPathNoticeText: { color: desktopSurfaces.textMuted, fontSize: 11, lineHeight: 16, marginTop: 1 },
  ganttSplit: { flexDirection: 'row', alignItems: 'stretch' },
  ganttActivityPane: { width: 390, flexShrink: 0, borderRightWidth: 1, borderRightColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card },
  ganttActivityHeader: { height: 44, backgroundColor: desktopSurfaces.dataHeader, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ganttHeaderText: { color: desktopSurfaces.dataHeaderMuted, fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 0.8 },
  ganttActivityRow: { height: 58, borderBottomWidth: 1, borderBottomColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ganttRowAlternate: { backgroundColor: desktopSurfaces.cardMuted },
  ganttSummaryRow: { backgroundColor: desktopSurfaces.sectionStrong },
  ganttActivityCopy: { flex: 1, minWidth: 0 },
  ganttProjectLabel: { color: desktopSurfaces.accentText, fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
  ganttItemName: { color: desktopSurfaces.text, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  ganttSummaryName: { fontSize: 13, fontWeight: '900' },
  ganttCriticalLabel: { alignSelf: 'flex-start', color: '#A8332C', fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.5 },
  ganttDateText: { width: 108, color: desktopSurfaces.textMuted, fontSize: 10, lineHeight: 15, fontWeight: '700', textAlign: 'right' },
  ganttTimelineScroll: { flex: 1, minWidth: 0, backgroundColor: desktopSurfaces.canvasDeep },
  ganttTimelineHeader: { height: 44, backgroundColor: desktopSurfaces.dataHeader, position: 'relative' },
  ganttColumnHeader: { height: 44, position: 'absolute', top: 0, borderRightWidth: 1, borderRightColor: '#4D5254', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  ganttColumnLabel: { color: desktopSurfaces.dataHeaderMuted, fontSize: 10, lineHeight: 14, fontWeight: '900' },
  ganttTimelineCanvas: { position: 'relative', backgroundColor: desktopSurfaces.card },
  ganttGridColumn: { position: 'absolute', top: 0, bottom: 0, borderRightWidth: 1, borderRightColor: desktopSurfaces.border, backgroundColor: 'transparent' },
  ganttTodayLine: { width: 2, position: 'absolute', top: 0, bottom: 0, zIndex: 4, backgroundColor: '#D44343' },
  ganttTodayLabel: { width: 42, position: 'absolute', top: 2, left: -20, color: '#A92B2B', backgroundColor: '#FFE8E4', fontSize: 8, lineHeight: 12, fontWeight: '900', textAlign: 'center' },
  ganttTimelineRow: { position: 'absolute', left: 0, borderBottomWidth: 1, borderBottomColor: desktopSurfaces.border, backgroundColor: 'transparent' },
  ganttTimelineRowAlternate: { backgroundColor: 'rgba(234, 242, 251, 0.55)' },
  ganttBar: { height: 25, position: 'absolute', borderRadius: 7, borderWidth: 1, borderColor: desktopSurfaces.accentStrong, backgroundColor: desktopSurfaces.accentSoft, overflow: 'hidden', zIndex: 2 },
  ganttSummaryBar: { height: 17, borderRadius: 3, backgroundColor: desktopSurfaces.dataHeader, borderColor: desktopSurfaces.dataHeader, overflow: 'visible' },
  ganttCompleteBar: { backgroundColor: '#DDF2E5', borderColor: '#3D8A5A' },
  ganttCriticalBar: { borderWidth: 2, borderColor: '#C23C33', boxShadow: '0 0 0 2px rgba(194,60,51,0.14)' },
  ganttProgressBar: { height: '100%', backgroundColor: desktopSurfaces.accent, borderTopLeftRadius: 5, borderBottomLeftRadius: 5 },
  ganttBaselineBar: { height: 7, position: 'absolute', borderRadius: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: '#64748B', backgroundColor: '#CBD5E1', zIndex: 1 },
  ganttMilestone: { width: 17, height: 17, position: 'absolute', backgroundColor: desktopSurfaces.accent, borderWidth: 2, borderColor: desktopSurfaces.accentStrong, transform: [{ rotate: '45deg' }], zIndex: 3 },
  ganttMissingDate: { position: 'absolute', top: 20, left: spacing.sm, color: desktopSurfaces.textMuted, fontSize: 10, lineHeight: 15, fontStyle: 'italic' },
  impactPanel: { borderTopWidth: 1, borderTopColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.section, padding: spacing.lg, gap: spacing.sm },
  impactHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  impactHeadingActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  impactTitle: { color: desktopSurfaces.text, fontSize: 17, lineHeight: 22, fontWeight: '900' },
  impactDetail: { color: desktopSurfaces.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  impactSafety: { borderRadius: 999, backgroundColor: desktopSurfaces.cardGreen, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  impactSafetyDanger: { backgroundColor: desktopSurfaces.cardRose },
  impactSafetyText: { color: '#27603B', fontSize: 11, lineHeight: 15, fontWeight: '900' },
  impactSafetyTextDanger: { color: '#8B2B24' },
  impactIssues: { borderRadius: 10, borderWidth: 1, borderColor: '#E5A4A4', backgroundColor: desktopSurfaces.cardRose, padding: spacing.sm, gap: 3 },
  impactIssueText: { color: '#8B2B24', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  impactEmpty: { color: desktopSurfaces.textMuted, fontSize: 13, lineHeight: 18, fontStyle: 'italic' },
  impactChange: { minHeight: 54, borderRadius: 10, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  impactChangeCopy: { flex: 1, minWidth: 260 },
  impactChangeName: { color: desktopSurfaces.text, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  impactChangeReason: { color: desktopSurfaces.textMuted, fontSize: 11, lineHeight: 16 },
  impactDates: { color: desktopSurfaces.accentText, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  impactChangeAction: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  impactApplyButton: { minWidth: 96, minHeight: 36, borderRadius: 9, backgroundColor: desktopSurfaces.accent, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  impactApplyAllButton: { minWidth: 126, minHeight: 36, borderRadius: 9, backgroundColor: desktopSurfaces.accent, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  impactApplyButtonText: { color: desktopSurfaces.onAccent, fontSize: 11, lineHeight: 16, fontWeight: '900' },
  lookaheadSurface: { minWidth: 1000, borderRadius: 16, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.section, overflow: 'hidden', boxShadow: desktopSurfaces.shadowStrong },
  lookaheadToolbar: { minHeight: 76, borderBottomWidth: 1, borderBottomColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.sectionStrong, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  lookaheadActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  lookaheadMetrics: { padding: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  lookaheadTable: { marginHorizontal: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, overflow: 'hidden' },
  lookaheadHeader: { minHeight: 42, backgroundColor: desktopSurfaces.dataHeader, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  lookaheadHeaderText: { color: desktopSurfaces.dataHeaderMuted, fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 0.7, paddingHorizontal: spacing.xs },
  lookaheadProjectHeading: { minHeight: 46, backgroundColor: desktopSurfaces.sectionStrong, borderTopWidth: 1, borderTopColor: desktopSurfaces.border, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lookaheadProjectName: { color: desktopSurfaces.text, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  lookaheadAreaHeading: { minHeight: 38, backgroundColor: desktopSurfaces.cardMuted, borderTopWidth: 1, borderTopColor: desktopSurfaces.border, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  lookaheadAreaName: { color: desktopSurfaces.accentText, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  lookaheadAreaCount: { marginLeft: 'auto', color: desktopSurfaces.textMuted, fontSize: 11, lineHeight: 16, fontWeight: '900' },
  lookaheadRow: { minHeight: 62, borderTopWidth: 1, borderTopColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  lookaheadWbs: { width: 66 },
  lookaheadName: { flex: 1, minWidth: 260, paddingHorizontal: spacing.xs },
  lookaheadNameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  lookaheadItemName: { flexShrink: 1, color: desktopSurfaces.text, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  lookaheadResponsibility: { color: desktopSurfaces.textMuted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  lookaheadDate: { width: 88 },
  lookaheadContractor: { width: 160 },
  lookaheadStatus: { width: 116, paddingHorizontal: spacing.xs },
  criticalBadge: { borderRadius: 999, backgroundColor: desktopSurfaces.cardRose, paddingHorizontal: 7, paddingVertical: 3 },
  criticalBadgeText: { color: '#A8332C', fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.5 },
  readinessPill: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: desktopSurfaces.cardMuted, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  readinessOverdue: { backgroundColor: desktopSurfaces.cardRose },
  readinessBlocked: { backgroundColor: desktopSurfaces.cardRose },
  readinessProgress: { backgroundColor: desktopSurfaces.cardAmber },
  readinessReady: { backgroundColor: desktopSurfaces.cardGreen },
  readinessText: { color: desktopSurfaces.text, fontSize: 10, lineHeight: 14, fontWeight: '900' },
  lookaheadFootnote: { color: desktopSurfaces.textMuted, fontSize: 11, lineHeight: 16, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
});
