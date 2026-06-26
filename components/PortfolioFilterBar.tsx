import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type {
  PortfolioFilterKey,
  PortfolioSortKey,
} from '../services/PortfolioDashboardService';
import { colors } from './ProjectDetailsCard';

export function PortfolioFilterBar({
  sortOptions,
  selectedSort,
  onSelectSort,
  filterOptions,
  selectedFilter,
  onSelectFilter,
}: {
  sortOptions: PortfolioSortKey[];
  selectedSort: PortfolioSortKey;
  onSelectSort: (sort: PortfolioSortKey) => void;
  filterOptions: PortfolioFilterKey[];
  selectedFilter: PortfolioFilterKey;
  onSelectFilter: (filter: PortfolioFilterKey) => void;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.label}>
        Filter
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {filterOptions.map(filter => (
          <Chip
            key={filter}
            label={filter}
            selected={selectedFilter === filter}
            onPress={() => onSelectFilter(filter)}
          />
        ))}
      </ScrollView>

      <Text style={styles.label}>
        Sort
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {sortOptions.map(sort => (
          <Chip
            key={sort}
            label={sort}
            selected={selectedSort === sort}
            onPress={() => onSelectSort(sort)}
          />
        ))}
      </ScrollView>
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
  panel: {
    marginBottom: 14,
  },

  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 8,
    textTransform: 'uppercase',
  },

  chipRow: {
    gap: 8,
    paddingBottom: 8,
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
