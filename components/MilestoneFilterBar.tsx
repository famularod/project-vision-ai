import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { MilestoneFilter } from '../services/MilestoneTrackingService';
import { colors } from './ProjectDetailsCard';

export function MilestoneFilterBar({
  filters,
  selectedFilter,
  onSelectFilter,
  projects,
  selectedProject,
  onSelectProject,
}: {
  filters: readonly MilestoneFilter[];
  selectedFilter: MilestoneFilter;
  onSelectFilter: (filter: MilestoneFilter) => void;
  projects: string[];
  selectedProject: string | null;
  onSelectProject: (projectName: string | null) => void;
}) {
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {filters.map(filter => (
          <Chip
            key={filter}
            label={filter}
            selected={selectedFilter === filter}
            onPress={() => onSelectFilter(filter)}
          />
        ))}
      </ScrollView>

      {selectedFilter === 'By Project' ? (
        <>
          <Text style={styles.projectLabel}>
            Project
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <Chip
              label="All Projects"
              selected={!selectedProject}
              onPress={() => onSelectProject(null)}
            />

            {projects.map(project => (
              <Chip
                key={project}
                label={project}
                selected={selectedProject === project}
                onPress={() => onSelectProject(project)}
              />
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        selected && styles.chipSelected,
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.chipText,
          selected && styles.chipTextSelected,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 14,
  },

  chipRow: {
    gap: 8,
    paddingBottom: 8,
  },

  projectLabel: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginTop: 3,
    marginBottom: 7,
  },

  chip: {
    backgroundColor: colors.card,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  chipText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
  },

  chipTextSelected: {
    color: '#FFFFFF',
  },
});
