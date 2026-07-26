import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { CloudProject, CloudProjectUpdate } from '../../services/SupabaseService';
import { scheduleTasksForParentProject } from '../../services/dave-project-schedule-rollup';
import type { DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';
import { scheduleProjectScopeNames } from '../../services/PIEScheduleImportBatch';
import { colors, radius, spacing } from '../../theme';
import { desktopSurfaces } from './desktop-surface-palette';
import type { ProjectUpdate, ScheduleItem } from '../../types';
import { daysUntilDate } from '../../utils/date';

export function DesktopOverviewPage({
  documents,
  projects,
  selectedProject,
  tasks,
  updates,
}: {
  documents: readonly DAVEWebReferenceDocument[];
  projects: readonly CloudProject[];
  selectedProject: string | null;
  tasks: readonly ScheduleItem[];
  updates: readonly CloudProjectUpdate<ProjectUpdate>[];
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 1180;
  const completedTasks = tasks.filter(taskIsComplete);
  const openTasks = tasks.filter(task => !taskIsComplete(task));
  const priorityTask = [...openTasks].sort(comparePriorityTasks)[0] ?? null;
  const recentUpdates = [...updates].sort(compareUpdatesNewestFirst).slice(0, 6);

  return (
    <View style={styles.page}>
      <View style={styles.healthCard}>
        <View style={styles.healthHeader}>
          <View>
            <Text style={styles.healthEyebrow}>PORTFOLIO</Text>
            <Text style={styles.healthTitle}>Project Health</Text>
          </View>
          <Ionicons name="pulse-outline" size={28} color={desktopSurfaces.heroText} />
        </View>
        <View style={styles.healthMetrics}>
          <HealthMetric label="Active Projects" value={projects.length} />
          <HealthMetric label="Total Tasks" value={tasks.length} />
          <HealthMetric label="Completed" value={completedTasks.length} />
          <HealthMetric label="Open" value={openTasks.length} />
          <HealthMetric label="Field Updates" value={updates.length} />
          <HealthMetric label="Documents" value={documents.length} />
        </View>
      </View>

      <View style={[styles.workspace, wide && styles.workspaceWide]}>
        <View style={[styles.primaryColumn, wide && styles.primaryColumnWide]}>
          <SectionHeading title="Today's Priority" />
          <PriorityCard task={priorityTask} selectedProject={selectedProject} />

          <SectionHeading title="Active Projects" />
          <View style={styles.projectGrid}>
            {projects.map(project => (
              <OverviewProjectCard
                key={project.id ?? project.name}
                project={project}
                tasks={tasks}
                updates={updates}
              />
            ))}
          </View>
        </View>

        <View style={[styles.secondaryColumn, wide && styles.secondaryColumnWide]}>
          <SectionHeading title="Recent Activity" />
          <View style={styles.activityPanel}>
            {recentUpdates.length ? recentUpdates.map(update => (
              <RecentActivityRow key={update.id} update={update} />
            )) : (
              <View style={styles.emptyActivity}>
                <Ionicons name="time-outline" size={28} color={colors.tertiaryText} />
                <Text style={styles.emptyActivityTitle}>No recent field activity</Text>
                <Text style={styles.emptyActivityText}>New project updates will appear here.</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function HealthMetric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.healthMetric}>
      <Text style={styles.healthMetricValue}>{value}</Text>
      <Text style={styles.healthMetricLabel}>{label}</Text>
    </View>
  );
}

function SectionHeading({ title }: { title: string }) {
  return <Text style={styles.sectionHeading} accessibilityRole="header">{title}</Text>;
}

function PriorityCard({
  task,
  selectedProject,
}: {
  task: ScheduleItem | null;
  selectedProject: string | null;
}) {
  if (!task) {
    return (
      <View style={styles.priorityCard}>
        <View style={styles.priorityVisual}>
          <View style={styles.clearIcon}>
            <Ionicons name="checkmark-circle" size={34} color={colors.success} />
          </View>
          <Text style={styles.clearTitle}>All clear</Text>
          <Text style={styles.clearText}>There are no open tasks in this project scope.</Text>
        </View>
      </View>
    );
  }

  const projectName = task.scheduleProjectName || task.projectName || selectedProject || 'Project';
  const areaName = task.locationName?.trim() || 'No area assigned';
  const days = daysUntilDate(task.finishDate, new Date(), task.projectTimeZone || undefined);
  const timing = priorityTiming(days);
  const nextAction = task.nextAction?.trim() || defaultPriorityAction(task, days);

  return (
    <View style={styles.priorityCard}>
      <View style={styles.priorityVisual}>
        <View style={styles.priorityVisualHeader}>
          <View style={styles.priorityBadge}>
            <Ionicons name="sparkles-outline" size={15} color={colors.warning} />
            <Text style={styles.priorityBadgeText}>PRIORITY</Text>
          </View>
          <Ionicons name="construct-outline" size={54} color="rgba(255,255,255,0.24)" />
        </View>
        <Text style={styles.priorityTiming}>{timing}</Text>
        <Text style={styles.priorityVisualProject}>{projectName}</Text>
        <Text style={styles.priorityVisualArea}>{areaName}</Text>
      </View>
      <View style={styles.priorityContent}>
        <View style={styles.priorityTitleRow}>
          <View style={styles.priorityTitleCopy}>
            <Text style={styles.priorityTitle}>{task.taskName}</Text>
            <Text style={styles.priorityMeta}>{task.status} · {task.percentComplete}% complete · {task.priority} priority</Text>
          </View>
          <View style={styles.priorityStatusPill}>
            <Text style={styles.priorityStatusText}>{task.status}</Text>
          </View>
        </View>
        <View style={styles.nextActionCard}>
          <Ionicons name="arrow-forward-circle-outline" size={22} color={desktopSurfaces.accent} />
          <View style={styles.nextActionCopy}>
            <Text style={styles.nextActionLabel}>NEXT ACTION</Text>
            <Text style={styles.nextActionText}>{nextAction}</Text>
          </View>
        </View>
        <Link href={{ pathname: '/tasks', params: { project: projectName } }} asChild>
          <Pressable style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]} accessibilityRole="link">
            <Text style={styles.primaryActionText}>Review priority</Text>
            <Ionicons name="arrow-forward" size={18} color={desktopSurfaces.onAccent} />
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

function OverviewProjectCard({
  project,
  tasks,
  updates,
}: {
  project: CloudProject;
  tasks: readonly ScheduleItem[];
  updates: readonly CloudProjectUpdate<ProjectUpdate>[];
}) {
  const projectTasks = scheduleTasksForParentProject(project.name, [...tasks]);
  const complete = projectTasks.filter(taskIsComplete).length;
  const open = projectTasks.length - complete;
  const overdue = projectTasks.filter(taskIsOverdue).length;
  const percent = projectTasks.length ? Math.round((complete / projectTasks.length) * 100) : 0;
  const projectScopes = scheduleProjectScopeNames(project.name, [...tasks]);
  const projectUpdates = updates.filter(update => projectScopes.some(
    scope => normalize(update.projectName) === normalize(scope),
  )).length;
  const health = overdue ? 'At Risk' : open ? 'Active' : projectTasks.length ? 'Complete' : 'Needs Setup';
  const healthColor = overdue ? colors.warning : open ? desktopSurfaces.accent : projectTasks.length ? colors.success : colors.mutedText;

  return (
    <Link href={{ pathname: '/', params: { project: project.name } }} asChild>
      <Pressable style={({ pressed }) => [styles.projectCard, pressed && styles.pressed]} accessibilityRole="link">
        <View style={styles.projectCardHeader}>
          <View style={styles.projectIcon}>
            <Ionicons name="business-outline" size={21} color={desktopSurfaces.accent} />
          </View>
          <View style={styles.projectCardTitleCopy}>
            <Text style={styles.projectTitle} numberOfLines={1}>{project.name}</Text>
            <Text style={[styles.projectHealth, { color: healthColor }]}>{health}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.tertiaryText} />
        </View>
        <Text style={styles.projectProgress}>{complete} of {projectTasks.length} tasks complete</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${percent}%` }]} />
        </View>
        <View style={styles.projectStats}>
          <Text style={styles.projectStat}>{open} open</Text>
          <Text style={styles.projectStatDot}>•</Text>
          <Text style={styles.projectStat}>{projectUpdates} {projectUpdates === 1 ? 'update' : 'updates'}</Text>
          {overdue ? <><Text style={styles.projectStatDot}>•</Text><Text style={styles.projectOverdue}>{overdue} overdue</Text></> : null}
        </View>
      </Pressable>
    </Link>
  );
}

function RecentActivityRow({ update }: { update: CloudProjectUpdate<ProjectUpdate> }) {
  const photoCount = update.updateData.photos.length;
  const note = update.updateData.notes?.trim();
  const icon = photoCount ? 'camera-outline' : update.updateData.scheduleTaskName ? 'checkbox-outline' : 'document-text-outline';
  return (
    <View style={styles.activityRow}>
      <View style={styles.activityIcon}>
        <Ionicons name={icon} size={19} color={desktopSurfaces.accent} />
      </View>
      <View style={styles.activityCopy}>
        <View style={styles.activityHeadingRow}>
          <Text style={styles.activityProject} numberOfLines={1}>{update.projectName}</Text>
          <Text style={styles.activityDate}>{formatActivityDate(update.updatedAt ?? update.updateData.date)}</Text>
        </View>
        <Text style={styles.activityArea} numberOfLines={1}>{update.areaName || 'No area assigned'}</Text>
        <Text style={styles.activityDetail} numberOfLines={2}>
          {note || (photoCount ? `${photoCount} project ${photoCount === 1 ? 'photo' : 'photos'} added.` : update.updateData.scheduleTaskName ? `Updated ${update.updateData.scheduleTaskName}.` : 'Project update recorded.')}
        </Text>
      </View>
    </View>
  );
}

function taskIsComplete(task: ScheduleItem): boolean {
  return task.status === 'Complete' || task.percentComplete >= 100;
}

function taskIsOverdue(task: ScheduleItem): boolean {
  if (taskIsComplete(task)) return false;
  const days = daysUntilDate(task.finishDate, new Date(), task.projectTimeZone || undefined);
  return days !== null && days < 0;
}

function comparePriorityTasks(a: ScheduleItem, b: ScheduleItem): number {
  const overdue = Number(taskIsOverdue(b)) - Number(taskIsOverdue(a));
  if (overdue) return overdue;
  const priority = priorityRank(b.priority) - priorityRank(a.priority);
  if (priority) return priority;
  return safeDate(a.finishDate) - safeDate(b.finishDate);
}

function compareUpdatesNewestFirst(
  a: CloudProjectUpdate<ProjectUpdate>,
  b: CloudProjectUpdate<ProjectUpdate>,
): number {
  return updateDate(b.updatedAt ?? b.updateData.date) - updateDate(a.updatedAt ?? a.updateData.date);
}

function priorityRank(priority: string): number {
  return priority === 'High' ? 3 : priority === 'Medium' ? 2 : 1;
}

function safeDate(value: string | null | undefined): number {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function updateDate(value: string | null | undefined): number {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function priorityTiming(days: number | null): string {
  if (days === null) return 'Review the current field status';
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

function defaultPriorityAction(task: ScheduleItem, days: number | null): string {
  if (days !== null && days < 0) return `Confirm current field status and set a recovery date for ${task.taskName}.`;
  return `Confirm the crew, material, access, and next accountable step for ${task.taskName}.`;
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatActivityDate(value: string | null | undefined): string {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Recent';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  page: { gap: spacing.lg },
  healthCard: { borderRadius: 18, borderWidth: 1, borderColor: desktopSurfaces.accentStrong, backgroundColor: desktopSurfaces.hero, padding: spacing.xl, gap: spacing.lg, boxShadow: desktopSurfaces.shadowStrong },
  healthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  healthEyebrow: { color: desktopSurfaces.heroMuted, fontSize: 12, lineHeight: 16, fontWeight: '900', letterSpacing: 1.6 },
  healthTitle: { color: desktopSurfaces.heroText, fontSize: 27, lineHeight: 33, fontWeight: '900', marginTop: 3 },
  healthMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  healthMetric: { flex: 1, flexBasis: 120, minWidth: 104 },
  healthMetricValue: { color: desktopSurfaces.heroText, fontSize: 30, lineHeight: 36, fontWeight: '900' },
  healthMetricLabel: { color: desktopSurfaces.heroMuted, fontSize: 12, lineHeight: 17, fontWeight: '800', marginTop: 3 },
  workspace: { gap: spacing.lg },
  workspaceWide: { flexDirection: 'row', alignItems: 'flex-start' },
  primaryColumn: { minWidth: 0, borderRadius: 18, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.section, padding: spacing.xl, gap: spacing.md, boxShadow: desktopSurfaces.shadow },
  primaryColumnWide: { flex: 1.15 },
  secondaryColumn: { minWidth: 0, borderRadius: 18, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.sectionStrong, padding: spacing.xl, gap: spacing.md, boxShadow: desktopSurfaces.shadow },
  secondaryColumnWide: { flex: 0.85 },
  sectionHeading: { color: colors.text, fontSize: 24, lineHeight: 31, fontWeight: '900', marginTop: spacing.xs },
  priorityCard: { borderRadius: 16, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, overflow: 'hidden', boxShadow: desktopSurfaces.shadow },
  priorityVisual: { minHeight: 176, backgroundColor: desktopSurfaces.heroStrong, padding: spacing.xl, justifyContent: 'flex-end' },
  priorityVisualHeader: { position: 'absolute', top: spacing.xl, left: spacing.xl, right: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priorityBadge: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: '#FFF4E5', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  priorityBadgeText: { color: '#B46600', fontSize: 11, lineHeight: 14, fontWeight: '900', letterSpacing: 1.3 },
  priorityTiming: { color: desktopSurfaces.onAccent, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  priorityVisualProject: { color: 'rgba(255,255,255,0.92)', fontSize: 16, lineHeight: 22, fontWeight: '800', marginTop: spacing.sm },
  priorityVisualArea: { color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 2 },
  clearIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: desktopSurfaces.card, alignItems: 'center', justifyContent: 'center' },
  clearTitle: { color: colors.text, fontSize: 26, lineHeight: 33, fontWeight: '900', marginTop: spacing.md },
  clearText: { color: colors.mutedText, fontSize: 15, lineHeight: 21, marginTop: spacing.xs },
  priorityContent: { padding: spacing.xl, gap: spacing.lg },
  priorityTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  priorityTitleCopy: { flex: 1, minWidth: 0 },
  priorityTitle: { color: colors.text, fontSize: 23, lineHeight: 29, fontWeight: '900' },
  priorityMeta: { color: colors.mutedText, fontSize: 14, lineHeight: 20, marginTop: 5 },
  priorityStatusPill: { borderRadius: 999, backgroundColor: colors.warningSoft, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  priorityStatusText: { color: '#9A5700', fontSize: 12, lineHeight: 16, fontWeight: '900' },
  nextActionCard: { borderRadius: radius.lg, backgroundColor: desktopSurfaces.accentSoft, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md },
  nextActionCopy: { flex: 1, gap: 3 },
  nextActionLabel: { color: desktopSurfaces.accentText, fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 1.1 },
  nextActionText: { color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  primaryAction: { minHeight: 52, borderRadius: 14, backgroundColor: desktopSurfaces.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  primaryActionText: { color: desktopSurfaces.onAccent, fontSize: 16, lineHeight: 21, fontWeight: '900' },
  pressed: { opacity: 0.72 },
  projectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  projectCard: { flexGrow: 1, flexBasis: 300, minWidth: 260, borderRadius: radius.lg, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, borderTopWidth: 4, borderTopColor: desktopSurfaces.accent, backgroundColor: desktopSurfaces.card, padding: spacing.lg, gap: spacing.md, boxShadow: desktopSurfaces.shadow },
  projectCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  projectIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: desktopSurfaces.accentSoft, alignItems: 'center', justifyContent: 'center' },
  projectCardTitleCopy: { flex: 1, minWidth: 0 },
  projectTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '900' },
  projectHealth: { fontSize: 12, lineHeight: 17, fontWeight: '900', marginTop: 2 },
  projectProgress: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: desktopSurfaces.accent },
  projectStats: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  projectStat: { color: colors.mutedText, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  projectStatDot: { color: colors.tertiaryText, fontSize: 12 },
  projectOverdue: { color: colors.danger, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  activityPanel: { borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, paddingHorizontal: spacing.lg, boxShadow: desktopSurfaces.shadow },
  activityRow: { minHeight: 98, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.lg },
  activityIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: desktopSurfaces.accentSoft, alignItems: 'center', justifyContent: 'center' },
  activityCopy: { flex: 1, minWidth: 0 },
  activityHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  activityProject: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  activityDate: { color: colors.tertiaryText, fontSize: 11, lineHeight: 16, fontWeight: '800' },
  activityArea: { color: colors.mutedText, fontSize: 12, lineHeight: 17, fontWeight: '700', marginTop: 2 },
  activityDetail: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: 6 },
  emptyActivity: { alignItems: 'center', padding: spacing.xxl },
  emptyActivityTitle: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '900', marginTop: spacing.sm },
  emptyActivityText: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: 3 },
});
