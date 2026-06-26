import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  StyleProp,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { DashboardMetric } from '../components/DashboardMetric';
import {
  EmptyState,
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
  colors,
  styles,
} from '../components/ProjectDetailsCard';
import { ScheduleItemRow } from '../components/ScheduleItemRow';
import {
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  SCHEDULE_PRIORITIES,
  SCHEDULE_STATUSES,
  ScheduleItem,
  SchedulePriority,
  ScheduleStatus,
} from '../types';
import {
  daysUntilDate,
  dueStatusText,
  formatSavedTime,
  normalizeDateInput,
  parseFlexibleDate,
} from '../utils/date';
import {
  actionItemsFromUpdates,
  sortedScheduleItems,
} from '../utils/schedule';

export function ScheduleScreen({
  contentStyle,
  scheduleItems,
  savedUpdates,
  projectAreas,
  projects,
  scheduleDocuments,
  onBack,
  onOpenDocument,
  onDeleteDocument,
  onSetActiveDocument,
  onAdd,
  onUpdate,
  onDelete,
  onImport,
  scheduleAiExtractorUrl,
  onScheduleAiExtractorUrlChange,
}: {
  contentStyle: StyleProp<ViewStyle>;
  scheduleItems: ScheduleItem[];
  savedUpdates: ProjectUpdate[];
  projectAreas: ProjectArea[];
  projects: string[];
  scheduleDocuments: ReferenceDocument[];
  onBack: () => void;
  onOpenDocument: (document: ReferenceDocument) => void;
  onDeleteDocument: (documentId: string) => void;
  onSetActiveDocument: (documentId: string) => void;
  onAdd: (item: Partial<ScheduleItem>) => void;
  onUpdate: (itemId: string, next: Partial<ScheduleItem>) => void;
  onDelete: (itemId: string) => void;
  onImport: () => void;
  scheduleAiExtractorUrl: string;
  onScheduleAiExtractorUrlChange: (value: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [projectName, setProjectName] = useState(projects[0] || '');
  const [locationName, setLocationName] = useState(projectAreas[0]?.name || '');
  const [startDate, setStartDate] = useState('');
  const [finishDate, setFinishDate] = useState('');
  const [milestone, setMilestone] = useState('');
  const [owner, setOwner] = useState('');
  const [contractor, setContractor] = useState('');
  const [percentComplete, setPercentComplete] = useState('0');
  const [priority, setPriority] = useState<SchedulePriority>('Medium');
  const [status, setStatus] = useState<ScheduleStatus>('Not Started');
  const [notes, setNotes] = useState('');

  const actionItems = actionItemsFromUpdates(savedUpdates);

  const sortedItems = sortedScheduleItems(scheduleItems);

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

  function resetForm() {
    setTaskName('');
    setProjectName(projects[0] || '');
    setLocationName(projectAreas[0]?.name || '');
    setStartDate('');
    setFinishDate('');
    setMilestone('');
    setOwner('');
    setContractor('');
    setPercentComplete('0');
    setPriority('Medium');
    setStatus('Not Started');
    setNotes('');
  }

  function startScheduleItemFromPdf(document: ReferenceDocument) {
    setTaskName('');
    setProjectName(projects[0] || '');
    setLocationName(projectAreas[0]?.name || '');
    setStartDate('');
    setFinishDate('');
    setMilestone('From PDF Schedule');
    setOwner('');
    setContractor('');
    setPercentComplete('0');
    setPriority('Medium');
    setStatus('Not Started');
    setNotes(`Source PDF: ${document.originalFileName}. Open the PDF, review the Gantt chart, then enter the task name, dates, owner, and location from the schedule.`);
    setShowAdd(true);
  }

  function submitManualItem() {
    if (!taskName.trim()) {
      Alert.alert('Task needed', 'Enter the schedule task or milestone first.');
      return;
    }

    if (finishDate.trim() && !parseFlexibleDate(finishDate)) {
      Alert.alert('Invalid finish date', 'Use MM/DD/YYYY for the finish or due date.');
      return;
    }

    if (startDate.trim() && !parseFlexibleDate(startDate)) {
      Alert.alert('Invalid start date', 'Use MM/DD/YYYY for the start date.');
      return;
    }

    onAdd({
      taskName,
      projectName,
      locationName,
      startDate,
      finishDate,
      milestone,
      owner,
      contractor,
      percentComplete: Number(percentComplete) || 0,
      priority,
      status,
      notes,
    });

    resetForm();
    setShowAdd(false);
  }

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={sortedItems}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <ScheduleItemRow
          item={item}
          onUpdate={next => onUpdate(item.id, next)}
          onDelete={() => onDelete(item.id)}
        />
      )}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Schedule"
            subtitle="Track project timelines, milestones, and due-soon work."
          />

          <SecondaryButton
            label="Back to Home"
            icon="arrow-back-outline"
            onPress={onBack}
          />

          <View style={styles.dashboardGrid}>
            <DashboardMetric
              label="Schedule Items"
              value={scheduleItems.length}
              icon="calendar-outline"
            />

            <DashboardMetric
              label="Due 7 Days"
              value={dueSoon.length}
              icon="time-outline"
            />

            <DashboardMetric
              label="Overdue"
              value={overdue.length}
              icon="alert-circle-outline"
              danger={overdue.length > 0}
            />

            <DashboardMetric
              label="Open Actions"
              value={actionItems.length}
              icon="checkbox-outline"
            />
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Schedule Import</Text>
            <Text style={styles.bodyText}>
              Import a PDF Gantt chart. The app will first use your AI/OCR extractor endpoint if one is saved, then fall back to readable PDF text extraction. Scanned or flattened Gantt charts usually require AI/OCR.
            </Text>

            <Text style={styles.label}>AI/OCR extractor endpoint</Text>
            <TextInput
              style={styles.input}
              value={scheduleAiExtractorUrl}
              onChangeText={onScheduleAiExtractorUrlChange}
              placeholder="https://your-secure-schedule-extractor.example.com/extract"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <Text style={styles.mutedNote}>
              For scanned Gantt PDFs, connect a secure OCR/AI endpoint that accepts the PDF and returns JSON schedule items. Leave blank to use best-effort PDF text extraction only.
            </Text>

            <View style={styles.dataActionRow}>
              <PrimaryButton
                label="Import PDF / CSV"
                icon="cloud-upload-outline"
                onPress={onImport}
                compact
              />

              <SecondaryButton
                label={showAdd ? 'Hide Manual Entry' : 'Add Manually'}
                icon="add-circle-outline"
                onPress={() => setShowAdd(prev => !prev)}
                compact
              />
            </View>
          </View>

          {scheduleDocuments.length ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Imported Schedule PDFs</Text>
              <Text style={styles.bodyText}>
                Keep only the current Gantt schedule active. Delete or archive outdated uploads so Upcoming is driven by the latest dates.
              </Text>

              {scheduleDocuments.map(document => (
                <View key={document.id} style={styles.compactLocationRow}>
                  <View style={styles.rowIconBubble}>
                    <Ionicons name="document-text-outline" size={20} color={colors.primary} />
                  </View>

                  <View style={styles.rowMain}>
                    <Text style={styles.projectName}>{document.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {document.originalFileName}
                    </Text>
                    <Text style={styles.rowSub}>
                      Imported {formatSavedTime(document.importedAt)} • {document.isCurrent ? 'Active schedule' : 'Inactive'}
                    </Text>
                  </View>

                  <View style={styles.compactActionColumn}>
                    <TouchableOpacity
                      style={styles.compactInlineAction}
                      onPress={() => onOpenDocument(document)}
                    >
                      <Text style={styles.compactInlineActionText}>Open</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.compactInlineAction}
                      onPress={() => startScheduleItemFromPdf(document)}
                    >
                      <Text style={styles.compactInlineActionText}>Add Item</Text>
                    </TouchableOpacity>
                    {!document.isCurrent ? (
                      <TouchableOpacity
                        style={styles.compactInlineAction}
                        onPress={() => onSetActiveDocument(document.id)}
                      >
                        <Text style={styles.compactInlineActionText}>Set Active</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={styles.compactInlineAction}
                      onPress={() => onDeleteDocument(document.id)}
                    >
                      <Text style={[styles.compactInlineActionText, { color: colors.danger }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : null}


          {showAdd ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Add Schedule Item</Text>

              <Text style={styles.label}>Task or milestone</Text>
              <TextInput
                style={styles.input}
                value={taskName}
                onChangeText={setTaskName}
                placeholder="Example: East driveway striping"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Project</Text>
              <TextInput
                style={styles.input}
                value={projectName}
                onChangeText={setProjectName}
                placeholder="Project name"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Location</Text>
              <TextInput
                style={styles.input}
                value={locationName}
                onChangeText={setLocationName}
                placeholder="Location / work area"
                placeholderTextColor={colors.muted}
              />

              <View style={styles.sendRow}>
                <View style={styles.rowMain}>
                  <Text style={styles.label}>Start</Text>
                  <TextInput
                    style={styles.input}
                    value={startDate}
                    onChangeText={value => setStartDate(normalizeDateInput(value))}
                    placeholder="MM/DD/YYYY"
                    placeholderTextColor={colors.muted}
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                  />
                </View>

                <View style={styles.rowMain}>
                  <Text style={styles.label}>Finish / Due</Text>
                  <TextInput
                    style={styles.input}
                    value={finishDate}
                    onChangeText={value => setFinishDate(normalizeDateInput(value))}
                    placeholder="MM/DD/YYYY"
                    placeholderTextColor={colors.muted}
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                  />
                </View>
              </View>

              <Text style={styles.label}>Owner</Text>
              <TextInput
                style={styles.input}
                value={owner}
                onChangeText={setOwner}
                placeholder="PLZ owner or internal owner"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Contractor</Text>
              <TextInput
                style={styles.input}
                value={contractor}
                onChangeText={setContractor}
                placeholder="Contractor / responsible company"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Percent Complete</Text>
              <TextInput
                style={styles.input}
                value={percentComplete}
                onChangeText={value => setPercentComplete(value.replace(/[^0-9]/g, '').slice(0, 3))}
                placeholder="0"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={3}
              />

              <Text style={styles.label}>Priority</Text>
              <View style={styles.statusGrid}>
                {SCHEDULE_PRIORITIES.map(itemPriority => (
                  <TouchableOpacity
                    key={itemPriority}
                    style={[
                      styles.statusButton,
                      priority === itemPriority && styles.statusButtonActive,
                    ]}
                    onPress={() => setPriority(itemPriority)}
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        priority === itemPriority && styles.statusButtonTextActive,
                      ]}
                    >
                      {itemPriority}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Milestone</Text>
              <TextInput
                style={styles.input}
                value={milestone}
                onChangeText={setMilestone}
                placeholder="Optional milestone"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Status</Text>
              <View style={styles.statusGrid}>
                {SCHEDULE_STATUSES.map(itemStatus => (
                  <TouchableOpacity
                    key={itemStatus}
                    style={[
                      styles.statusButton,
                      status === itemStatus && styles.statusButtonActive,
                    ]}
                    onPress={() => setStatus(itemStatus)}
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        status === itemStatus && styles.statusButtonTextActive,
                      ]}
                    >
                      {itemStatus}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={[styles.input, styles.notesInput]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Schedule notes, constraints, or next step."
                placeholderTextColor={colors.muted}
                multiline
              />

              <PrimaryButton
                label="Save Schedule Item"
                icon="checkmark-circle-outline"
                onPress={submitManualItem}
              />
            </View>
          ) : null}

          {dueSoon.length || overdue.length ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Needs Attention</Text>
              {[...overdue, ...dueSoon].slice(0, 6).map(item => (
                <View key={item.id} style={styles.compactLocationRow}>
                  <View style={styles.rowIconBubble}>
                    <Ionicons
                      name={daysUntilDate(item.finishDate)! < 0 ? 'alert-circle-outline' : 'time-outline'}
                      size={20}
                      color={daysUntilDate(item.finishDate)! < 0 ? colors.danger : colors.warning}
                    />
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.projectName}>{item.taskName}</Text>
                    <Text style={styles.rowSub}>{dueStatusText(item.finishDate)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {actionItems.length ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Open Action Items with Due Dates</Text>
              {actionItems.slice(0, 6).map(item => (
                <View key={item.id} style={styles.compactLocationRow}>
                  <View style={styles.rowIconBubble}>
                    <Ionicons name="checkbox-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.projectName}>{item.taskName}</Text>
                    <Text style={styles.rowSub}>
                      {item.projectName}{item.locationName ? ` • ${item.locationName}` : ''}
                    </Text>
                    <Text style={styles.rowSub}>{item.dueLabel}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.sectionLabel}>Timeline Items</Text>
        </>
      }
      ListEmptyComponent={
        <EmptyState
          title="No schedule items yet"
          text="Import a CSV/text schedule or add a schedule item manually."
        />
      }
    />
  );
}
