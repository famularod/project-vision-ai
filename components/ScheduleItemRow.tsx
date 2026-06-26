import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  SCHEDULE_PRIORITIES,
  SCHEDULE_STATUSES,
  ScheduleItem,
} from '../types';
import {
  daysUntilDate,
  dueStatusText,
  normalizeDateInput,
} from '../utils/date';
import { colors, styles } from './ProjectDetailsCard';

export function ScheduleItemRow({
  item,
  onUpdate,
  onDelete,
}: {
  item: ScheduleItem;
  onUpdate: (next: Partial<ScheduleItem>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const days = daysUntilDate(item.finishDate);
  const isOverdue = days !== null && days < 0 && item.status !== 'Complete';
  const isDueSoon = days !== null && days >= 0 && days <= 7 && item.status !== 'Complete';
  const priorityColor = item.priority === 'High' ? colors.danger : item.priority === 'Low' ? colors.success : colors.warning;
  const statusColor = item.status === 'Complete' ? colors.success : item.status === 'In Progress' ? colors.warning : item.status === 'Waiting' ? colors.muted : colors.primary;

  return (
    <View style={styles.savedRow}>
      <TouchableOpacity
        style={styles.rowIconBubble}
        onPress={() => setExpanded(prev => !prev)}
      >
        <Ionicons
          name={isOverdue ? 'alert-circle-outline' : isDueSoon ? 'time-outline' : 'calendar-outline'}
          size={20}
          color={isOverdue ? colors.danger : isDueSoon ? colors.warning : colors.primary}
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.rowMain}
        onPress={() => setExpanded(prev => !prev)}
      >
        <Text style={styles.projectName}>{item.taskName}</Text>
        <Text style={styles.rowSub}>
          {item.projectName || 'No project'}{item.locationName ? ` • ${item.locationName}` : ''}
        </Text>
        <Text style={styles.rowSub}>
          {item.finishDate ? dueStatusText(item.finishDate) : 'No finish date'}{item.contractor ? ` • ${item.contractor}` : ''}
        </Text>

        <View style={styles.scheduleMetaRow}>
          <View style={[styles.statusPill, { backgroundColor: `${statusColor}1A` }]}>
            <Text style={[styles.statusPillText, { color: statusColor }]}>{item.status}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: `${priorityColor}1A` }]}>
            <Text style={[styles.statusPillText, { color: priorityColor }]}>{item.priority}</Text>
          </View>
          <Text style={styles.percentText}>{item.percentComplete}%</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${item.percentComplete}%` }]} />
        </View>

        {expanded ? (
          <View style={styles.areaManagerCard}>
            <Text style={styles.label}>Finish / Due Date</Text>
            <TextInput
              style={styles.input}
              value={item.finishDate}
              onChangeText={finishDate => onUpdate({ finishDate: normalizeDateInput(finishDate) })}
              placeholder="MM/DD/YYYY"
              placeholderTextColor={colors.muted}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />

            <Text style={styles.label}>Owner</Text>
            <TextInput
              style={styles.input}
              value={item.owner}
              onChangeText={owner => onUpdate({ owner })}
              placeholder="PLZ owner / internal owner"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.label}>Contractor</Text>
            <TextInput
              style={styles.input}
              value={item.contractor}
              onChangeText={contractor => onUpdate({ contractor })}
              placeholder="Contractor / responsible company"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.label}>Percent Complete</Text>
            <TextInput
              style={styles.input}
              value={String(item.percentComplete)}
              onChangeText={value => onUpdate({ percentComplete: Math.max(0, Math.min(100, Number(value.replace(/[^0-9]/g, '')) || 0)) })}
              placeholder="0"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={3}
            />

            <Text style={styles.label}>Priority</Text>
            <View style={styles.statusGrid}>
              {SCHEDULE_PRIORITIES.map(priority => (
                <TouchableOpacity
                  key={priority}
                  style={[
                    styles.statusButton,
                    item.priority === priority && styles.statusButtonActive,
                  ]}
                  onPress={() => onUpdate({ priority })}
                >
                  <Text
                    style={[
                      styles.statusButtonText,
                      item.priority === priority && styles.statusButtonTextActive,
                    ]}
                  >
                    {priority}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Status</Text>
            <View style={styles.statusGrid}>
              {SCHEDULE_STATUSES.map(status => (
                <TouchableOpacity
                  key={status}
                  style={[
                    styles.statusButton,
                    item.status === status && styles.statusButtonActive,
                  ]}
                  onPress={() => onUpdate({ status })}
                >
                  <Text
                    style={[
                      styles.statusButtonText,
                      item.status === status && styles.statusButtonTextActive,
                    ]}
                  >
                    {status}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={item.notes}
              onChangeText={notes => onUpdate({ notes })}
              placeholder="Notes"
              placeholderTextColor={colors.muted}
              multiline
            />
          </View>
        ) : null}
      </TouchableOpacity>

      <TouchableOpacity style={styles.iconOnlyDangerButton} onPress={onDelete}>
        <Ionicons name="trash-outline" size={19} color={colors.danger} />
      </TouchableOpacity>
    </View>
  );
}
