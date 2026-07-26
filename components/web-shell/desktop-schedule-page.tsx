import { Ionicons } from '@expo/vector-icons';
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
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';
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
import { analyzeVitruviusSchedule } from '../../services/VitruviusScheduleAnalytics';
import {
  buildVitruviusScheduleHierarchy,
  nextScheduleSortOrder,
  nextScheduleWbsCode,
  planningDependenciesFromIds,
  scheduleParentOptions,
  schedulePredecessorOptions,
} from '../../services/VitruviusScheduleWorkspace';
import type { ScheduleItem, ScheduleStatus } from '../../types';
import { colors, spacing } from '../../theme';
import { useDesktopAuth } from './desktop-auth-provider';
import { desktopSurfaces } from './desktop-surface-palette';

type ScheduleEditorKind = 'task' | 'phase' | 'milestone';
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
  const [editor, setEditor] = useState<ScheduleEditorState | null>(null);
  const [editingTask, setEditingTask] = useState<DAVEWebScheduleItem | null>(null);
  const [workspaceView, setWorkspaceView] = useState<ScheduleWorkspaceView>('builder');
  const [ganttZoom, setGanttZoom] = useState<VitruviusGanttZoom>('week');
  const [lookaheadWeeks, setLookaheadWeeks] = useState<VitruviusLookaheadWeeks>(3);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [impactPendingItemId, setImpactPendingItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);
  const projectNames = uniqueText([
    ...(selectedProject ? [selectedProject] : []),
    ...projects,
    ...tasks.map(task => task.scheduleProjectName || task.projectName),
  ]);
  const groupedProjects = useMemo(
    () => projectNames
      .map(projectName => ({
        projectName,
        tasks: tasks.filter(task =>
          normalize(task.scheduleProjectName || task.projectName) === normalize(projectName),
        ),
      }))
      .filter(group => group.tasks.length > 0 || selectedProject === group.projectName),
    [projectNames, selectedProject, tasks],
  );
  const defaultProject = selectedProject || projectNames[0] || '';
  const editorProjectTasks = editor
    ? tasks.filter(task =>
        normalize(task.scheduleProjectName || task.projectName) === normalize(editor.projectName),
      )
    : [];

  const openNew = (kind: ScheduleEditorKind, parentItemId: string | null = null) => {
    const projectTasks = tasks.filter(task =>
      normalize(task.scheduleProjectName || task.projectName) === normalize(defaultProject),
    );
    setEditingTask(null);
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
    const dependencyLag = task.dependencies?.[0]?.lagDays ?? 0;
    setEditingTask(task);
    setEditor({
      kind: task.isSummary ? 'phase' : task.isMilestone ? 'milestone' : 'task',
      taskName: task.taskName,
      projectName: task.scheduleProjectName || task.projectName,
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
      predecessorItemIds: (task.dependencies || []).map(dependency =>
        dependency.predecessorItemId,
      ),
      lagDays: String(dependencyLag),
      owner: task.owner,
      contractor: task.contractor,
      percentComplete: String(task.percentComplete),
      status: task.status,
      notes: task.notes,
    });
    setNotice(null);
  };

  const save = async () => {
    if (!editor || pending) return;
    if (!editor.taskName.trim() || !editor.projectName.trim()) {
      setNotice({ tone: 'danger', text: 'Task name and project are required.' });
      return;
    }
    const percentComplete = Number(editor.percentComplete);
    if (!Number.isFinite(percentComplete) || percentComplete < 0 || percentComplete > 100) {
      setNotice({ tone: 'danger', text: 'Percent complete must be from 0 to 100.' });
      return;
    }
    const startDate = editor.startDate.trim();
    const finishDate = editor.kind === 'milestone'
      ? startDate
      : editor.finishDate.trim();
    const parsedStart = parseVitruviusScheduleDate(startDate);
    const parsedFinish = parseVitruviusScheduleDate(finishDate);
    if (editor.kind === 'milestone' && !parsedStart) {
      setNotice({ tone: 'danger', text: 'A milestone date is required.' });
      return;
    }
    if (startDate && !parsedStart) {
      setNotice({ tone: 'danger', text: 'Start date is not valid.' });
      return;
    }
    if (finishDate && !parsedFinish) {
      setNotice({ tone: 'danger', text: 'Finish date is not valid.' });
      return;
    }
    if (
      parsedStart &&
      parsedFinish &&
      parsedFinish.getTime() < parsedStart.getTime()
    ) {
      setNotice({ tone: 'danger', text: 'Finish date cannot be before the start date.' });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const projectTasks = tasks.filter(task =>
        normalize(task.scheduleProjectName || task.projectName) === normalize(editor.projectName),
      );
      const now = new Date().toISOString();
      const draft: DAVEWebTaskDraft = {
        itemType: 'Task',
        taskName: editor.taskName,
        projectName: editor.projectName,
        locationName: editor.locationName,
        startDate: editor.kind === 'phase' ? '' : startDate,
        finishDate: editor.kind === 'phase' ? '' : finishDate,
        milestone: editor.kind === 'milestone' ? editor.taskName : '',
        owner: editor.owner,
        contractor: editor.contractor,
        percentComplete,
        priority: editingTask?.priority || 'Medium',
        status: editor.status,
        notes: editor.notes,
        nextAction: editingTask?.nextAction || '',
        activityMessage: '',
        wbsCode: editor.wbsCode,
        parentItemId: editor.parentItemId,
        sortOrder: editingTask?.sortOrder ??
          nextScheduleSortOrder(editor.parentItemId || null, projectTasks),
        durationDays: editor.kind === 'milestone' ? 0 : editor.durationDays,
        dependencies: editor.kind === 'phase'
          ? []
          : planningDependenciesFromIds(editor.predecessorItemIds, editor.lagDays),
        isSummary: editor.kind === 'phase',
        isMilestone: editor.kind === 'milestone',
        baselineStartDate: editor.baselineStartDate,
        baselineFinishDate: editor.kind === 'milestone'
          ? editor.baselineStartDate
          : editor.baselineFinishDate,
      };
      const item = buildDAVEWebScheduleItem({
        draft,
        current: editingTask,
        id: editingTask?.id || createDAVEWebTaskId(),
        now,
        actor: auth.userEmail || 'Project manager',
      });
      if (editingTask) await auth.updateTask(item);
      else await auth.createTask(item);
      setEditor(null);
      setEditingTask(null);
      setNotice({
        tone: 'good',
        text: editingTask
          ? 'Schedule item updated and synced.'
          : 'Schedule item created and synced.',
      });
    } catch (error) {
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
        startDate: calculated.startDate,
        finishDate: calculated.finishDate,
        durationDays: calculated.durationDays,
        updatedAt: new Date().toISOString(),
      });
      setNotice({
        tone: 'good',
        text: `${current.taskName} moved to ${shortDate(calculated.startDate)}–${shortDate(calculated.finishDate)} and synced.`,
      });
    } catch (error) {
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
        startDate: calculated.startDate,
        finishDate: calculated.finishDate,
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
    try {
      const updated = await auth.updateTasks(updates);
      setNotice({
        tone: 'good',
        text: `${updated} calculated date change${updated === 1 ? '' : 's'} applied and synced.`,
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

      {editor ? (
        <ScheduleEditor
          state={editor}
          editingTask={editingTask}
          projects={projectNames}
          projectTasks={editorProjectTasks}
          pending={pending}
          onChange={setEditor}
          onCancel={() => {
            setEditor(null);
            setEditingTask(null);
          }}
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
          const hierarchy = buildVitruviusScheduleHierarchy(group.tasks);
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
                  const predecessor = group.tasks.find(task => task.id === dependency.predecessorItemId);
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
                          {row.item.isSummary ? 'Phase' : row.item.isMilestone ? 'Milestone' : 'Task'}
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
    () => buildVitruviusGanttModel({ items: tasks, zoom }),
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
          label={`Critical path (${criticalIds.size})`}
          selected={showCriticalPath}
          onPress={() => setShowCriticalPath(value => !value)}
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
      ) : null}

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
    () => buildVitruviusLookahead({ items: tasks, weeks }),
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
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.scheduleControl, selected && styles.scheduleControlSelected]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
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
          Current task dates already satisfy the saved finish-to-start relationships.
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
  pending,
  onChange,
  onCancel,
  onSave,
}: {
  state: ScheduleEditorState;
  editingTask: DAVEWebScheduleItem | null;
  projects: readonly string[];
  projectTasks: readonly DAVEWebScheduleItem[];
  pending: boolean;
  onChange: (value: ScheduleEditorState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const parentOptions = scheduleParentOptions(editingTask?.id || null, projectTasks);
  const predecessorOptions = schedulePredecessorOptions(editingTask?.id || null, projectTasks);
  const areaOptions = uniqueText(projectTasks.map(item => item.locationName));
  const canCaptureBaseline = Boolean(
    state.startDate.trim() &&
    (state.kind === 'milestone' || state.finishDate.trim()),
  );
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
          wide
        />
        <EditorField label="WBS" value={state.wbsCode} onChange={value => update('wbsCode', value)} />
        <ChoiceField
          label="Parent phase"
          value={state.parentItemId}
          options={parentOptions.map(item => item.id)}
          optionLabel={value => parentOptions.find(item => item.id === value)?.taskName || value}
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
          <View style={styles.choiceWrap}>
            {predecessorOptions.length === 0 ? (
              <Text style={styles.helpText}>No eligible predecessor tasks yet.</Text>
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
                  accessibilityState={{ checked: selected }}
                >
                  <Ionicons
                    name={selected ? 'checkbox' : 'square-outline'}
                    size={17}
                    color={selected ? desktopSurfaces.onAccent : desktopSurfaces.accent}
                  />
                  <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>
                    {item.wbsCode ? `${item.wbsCode} · ` : ''}{item.taskName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.formGrid}>
        <EditorField label="Contractor" value={state.contractor} onChange={value => update('contractor', value)} />
        <EditorField label="Percent complete" value={state.percentComplete} onChange={value => update('percentComplete', value)} numeric />
      </View>
      <View style={styles.relationshipSection}>
        <Text style={styles.fieldLabel}>Status</Text>
        <View style={styles.choiceWrap}>
          {(['Not Started', 'In Progress', 'Waiting', 'Complete'] as ScheduleStatus[]).map(status => (
            <Pressable
              key={status}
              style={[styles.choiceChip, state.status === status && styles.choiceChipSelected]}
              onPress={() => update('status', status)}
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
        />
      </View>
      <View style={styles.editorActions}>
        <Pressable style={styles.secondaryButton} onPress={onCancel} disabled={pending}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable style={[styles.primaryButton, pending && styles.disabled]} onPress={onSave} disabled={pending}>
          {pending ? <ActivityIndicator color={desktopSurfaces.onAccent} /> : (
            <Text style={styles.primaryButtonText}>{editingTask ? 'Save Changes' : `Create ${capitalize(state.kind)}`}</Text>
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
      <TextInput
        value={value}
        onChangeText={onChange}
        inputMode={numeric ? 'numeric' : 'text'}
        style={styles.input}
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
  wide = false,
}: {
  label: string;
  value: string;
  options: readonly string[];
  optionLabel?: (value: string) => string;
  onChange: (value: string) => void;
  allowNone?: boolean;
  wide?: boolean;
}) {
  return (
    <View style={[styles.formField, wide && styles.formFieldWide]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {createElement('select' as never, {
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        style: webSelectStyle,
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

function dateInputValue(value: string) {
  if (!value) return '';
  const direct = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function shortDate(value: string) {
  const normalizedValue = dateInputValue(value);
  if (!normalizedValue) return '—';
  const [year, month, day] = normalizedValue.split('-');
  return `${month}/${day}/${year?.slice(-2)}`;
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
  scheduleControlText: { color: desktopSurfaces.accentText, fontSize: 11, lineHeight: 16, fontWeight: '900' },
  scheduleControlTextSelected: { color: desktopSurfaces.onAccent },
  controlSummary: { marginLeft: 'auto', minHeight: 32, borderRadius: 9, backgroundColor: desktopSurfaces.cardGreen, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  controlSummaryText: { color: '#27603B', fontSize: 11, lineHeight: 16, fontWeight: '900' },
  controlSummaryTextLate: { color: '#8B2B24' },
  criticalPathWarning: { minHeight: 58, borderBottomWidth: 1, borderBottomColor: '#E5A4A4', backgroundColor: desktopSurfaces.cardRose, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  criticalPathWarningCopy: { flex: 1, minWidth: 0 },
  criticalPathWarningTitle: { color: '#8B2B24', fontSize: 13, lineHeight: 18, fontWeight: '900' },
  criticalPathWarningText: { color: '#8B2B24', fontSize: 11, lineHeight: 16, marginTop: 1 },
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
