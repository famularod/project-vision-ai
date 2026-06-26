import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleProp,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
  colors,
  styles,
} from '../components/ProjectDetailsCard';
import type {
  ProjectUpdate,
  ScheduleItem,
  SchedulePriority,
} from '../types';
import {
  daysUntilDate,
  dueStatusText,
  pluralWord,
} from '../utils/date';
import { actionItemsFromUpdates } from '../utils/schedule';

type UpcomingItem = {
  id: string;
  source: string;
  title: string;
  projectName: string;
  locationName: string;
  owner: string;
  contractor: string;
  dueDate: string;
  status: string;
  percentComplete: number;
  priority: SchedulePriority;
  notes: string;
  days: number | null;
};

export function UpcomingScreen({
  contentStyle,
  scheduleItems,
  savedUpdates,
  onSchedule,
  onNewUpdate,
  onMilestoneTracking,
}: {
  contentStyle: StyleProp<ViewStyle>;
  scheduleItems: ScheduleItem[];
  savedUpdates: ProjectUpdate[];
  onSchedule: () => void;
  onNewUpdate: () => void;
  onMilestoneTracking?: () => void;
}) {
  const [selectedSection, setSelectedSection] = useState<{
    title: string;
    items: UpcomingItem[];
  } | null>(null);

  const actionItems = actionItemsFromUpdates(savedUpdates);
  const combinedItems: Array<Omit<UpcomingItem, 'days'>> = [
    ...scheduleItems
      .filter(item => item.status !== 'Complete')
      .map(item => ({
        id: item.id,
        source: 'Schedule',
        title: item.taskName,
        projectName: item.projectName,
        locationName: item.locationName,
        owner: item.owner,
        contractor: item.contractor,
        dueDate: item.finishDate,
        status: item.status,
        percentComplete: item.percentComplete,
        priority: item.priority,
        notes: item.notes,
      })),
    ...actionItems.map(item => ({
      id: item.id,
      source: 'Action Item',
      title: item.taskName,
      projectName: item.projectName,
      locationName: item.locationName,
      owner: item.owner,
      contractor: '',
      dueDate: item.finishDate,
      status: item.status,
      percentComplete: 0,
      priority: 'High' as SchedulePriority,
      notes: '',
    })),
  ];

  const withDueDates: UpcomingItem[] = combinedItems
    .map(item => ({ ...item, days: daysUntilDate(item.dueDate) }))
    .filter(item => item.days !== null)
    .sort((a, b) => (a.days ?? 99999) - (b.days ?? 99999));

  const today = withDueDates.filter(item => item.days === 0);
  const tomorrow = withDueDates.filter(item => item.days === 1);
  const nextSevenDays = withDueDates.filter(
    item => item.days !== null && item.days >= 2 && item.days <= 7,
  );
  const overdue = withDueDates.filter(item => item.days !== null && item.days < 0);
  const later = withDueDates.filter(item => item.days !== null && item.days > 7);

  const renderUpcomingItem = (item: typeof withDueDates[number]) => (
    <View key={`${item.source}-${item.id}`} style={styles.savedRow}>
      <View style={styles.rowIconBubble}>
        <Ionicons
          name={item.days !== null && item.days < 0 ? 'alert-circle-outline' : item.days === 0 ? 'today-outline' : 'calendar-outline'}
          size={20}
          color={item.days !== null && item.days < 0 ? colors.danger : item.days === 0 ? colors.warning : colors.primary}
        />
      </View>

      <View style={styles.rowMain}>
        <Text style={styles.projectName}>{item.title || 'Untitled item'}</Text>
        <Text style={styles.rowSub}>
          {item.projectName || 'No project'}{item.locationName ? ` • ${item.locationName}` : ''}
        </Text>
        <Text style={styles.rowSub}>
          {dueStatusText(item.dueDate)} • {item.source}{item.contractor ? ` • ${item.contractor}` : item.owner ? ` • ${item.owner}` : ''}
        </Text>
        <View style={styles.scheduleMetaRow}>
          <View style={[styles.statusPill, { backgroundColor: `${colors.primary}1A` }]}>
            <Text style={styles.statusPillText}>{item.status} • {item.percentComplete}%</Text>
          </View>
        </View>
        {item.notes ? (
          <Text style={styles.rowSub} numberOfLines={2}>
            {item.notes}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const openSection = (title: string, items: typeof withDueDates) => {
    setSelectedSection({ title, items });
  };

  const renderSection = (title: string, items: typeof withDueDates, emptyText: string) => {
    const previewItems = items.slice(0, 2);
    const hasItems = items.length > 0;

    return (
      <TouchableOpacity
        style={styles.panel}
        activeOpacity={hasItems ? 0.82 : 1}
        onPress={() => hasItems && openSection(title, items)}
      >
        <View style={styles.sectionHeaderRow}>
          <View style={styles.rowMain}>
            <Text style={styles.panelTitle}>{title}</Text>
            {hasItems ? (
              <Text style={styles.rowSub}>
                Tap to view {items.length} {pluralWord(items.length, 'item')}
              </Text>
            ) : null}
          </View>

          <View style={[styles.countPill, title === 'Overdue' && items.length > 0 && styles.countPillDanger]}>
            <Text style={[styles.countPillText, title === 'Overdue' && items.length > 0 && styles.countPillTextDanger]}>
              {items.length}
            </Text>
          </View>
        </View>

        {hasItems ? (
          <>
            {previewItems.map(renderUpcomingItem)}
            {items.length > previewItems.length ? (
              <Text style={styles.inlineLinkText}>
                View all {items.length} {pluralWord(items.length, 'item')}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.bodyText}>{emptyText}</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <>
      <ScrollView
        style={styles.appFrame}
        contentContainerStyle={contentStyle}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenTitle
          title="Upcoming"
          subtitle="Tap a section to see the schedule items and action items due in that timeframe."
        />

        {withDueDates.length === 0 ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>No dated items yet</Text>
            <Text style={styles.bodyText}>
              Import a schedule PDF, add schedule items from the PDF, or add action item due dates to populate Upcoming.
            </Text>
          </View>
        ) : null}

        {renderSection('Due Today', today, 'No schedule items or action items are due today.')}
        {renderSection('Due Tomorrow', tomorrow, 'No items are due tomorrow.')}
        {renderSection('Next 7 Days', nextSevenDays, 'No additional items are due in the next seven days.')}
        {renderSection('Overdue', overdue, 'No overdue items.')}
        {renderSection('Later', later, 'No later dated items found yet.')}

        <View style={styles.dataActionRow}>
          <PrimaryButton
            label="Open Schedule"
            icon="calendar-outline"
            onPress={onSchedule}
            compact
          />
          <SecondaryButton
            label="Capture Update"
            icon="camera-outline"
            onPress={onNewUpdate}
            compact
          />
        </View>

        {onMilestoneTracking ? (
          <SecondaryButton
            label="Milestone Tracking"
            icon="flag-outline"
            onPress={onMilestoneTracking}
          />
        ) : null}
      </ScrollView>

      <Modal
        visible={Boolean(selectedSection)}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedSection(null)}
      >
        <View style={styles.photoModalBackdrop}>
          <SafeAreaView style={styles.photoModalSafeArea}>
            <View style={styles.photoModalHeader}>
              <View style={styles.photoModalTitleWrap}>
                <Text style={styles.photoModalTitle}>{selectedSection?.title}</Text>
                <Text style={styles.photoModalCaption}>
                  {selectedSection?.items.length || 0} {pluralWord(selectedSection?.items.length || 0, 'item')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.photoModalCloseButton}
                onPress={() => setSelectedSection(null)}
                accessibilityLabel="Close upcoming list"
              >
                <Ionicons name="close" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.appFrame}
              contentContainerStyle={[styles.content, { paddingTop: 8, paddingBottom: 24 }]}
            >
              {selectedSection?.items.map(renderUpcomingItem)}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}
