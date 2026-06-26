import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ContractorFilter } from '../services/ContractorPerformanceService';
import { colors, radius, spacing, typography } from '../theme';

export function ContractorFilterBar({ filters, selectedFilter, onSelectFilter, projects, selectedProject, onSelectProject }: {
  filters: readonly ContractorFilter[];
  selectedFilter: ContractorFilter;
  onSelectFilter: (filter: ContractorFilter) => void;
  projects: string[];
  selectedProject: string | null;
  onSelectProject: (project: string | null) => void;
}) {
  return <View style={styles.wrap}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {filters.map(filter => <Chip key={filter} label={filter} selected={filter === selectedFilter} onPress={() => onSelectFilter(filter)} />)}
    </ScrollView>
    {selectedFilter === 'By Project' ? <>
      <Text style={styles.label}>Project</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Chip label="All Projects" selected={!selectedProject} onPress={() => onSelectProject(null)} />
        {projects.map(project => <Chip key={project} label={project} selected={selectedProject === project} onPress={() => onSelectProject(project)} />)}
      </ScrollView>
    </> : null}
  </View>;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  row: { gap: spacing.xs, paddingBottom: spacing.xs },
  label: { ...typography.label, marginTop: spacing.xxs, marginBottom: spacing.xs },
  chip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: typography.caption,
  chipTextSelected: { color: colors.surface },
});
