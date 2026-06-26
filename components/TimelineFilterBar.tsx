import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import type { ConstructionTimelineFilter } from '../services/ConstructionTimelineService';
import { colors } from './ProjectDetailsCard';

export function TimelineFilterBar({
  filters,
  selectedFilter,
  onSelectFilter,
}: {
  filters: ConstructionTimelineFilter[];
  selectedFilter: ConstructionTimelineFilter;
  onSelectFilter: (filter: ConstructionTimelineFilter) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterRow}
    >
      {filters.map(filter => {
        const selected = selectedFilter === filter;

        return (
          <TouchableOpacity
            key={filter}
            style={[
              styles.filterChip,
              selected && styles.filterChipSelected,
            ]}
            onPress={() => onSelectFilter(filter)}
          >
            <Text
              style={[
                styles.filterText,
                selected && styles.filterTextSelected,
              ]}
            >
              {filter}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    gap: 8,
    paddingBottom: 12,
  },

  filterChip: {
    backgroundColor: colors.card,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  filterChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  filterText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
  },

  filterTextSelected: {
    color: '#FFFFFF',
  },
});
