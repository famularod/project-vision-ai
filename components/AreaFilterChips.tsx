import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type ProjectArea = {
  id: string;
  name: string;
};

type AreaFilterChipsProps = {
  projectAreas: ProjectArea[];
  areaFilterId: string | null;
  onChangeAreaFilter: (areaId: string | null) => void;
};

const colors = {
  fill: '#F2F2F7',
  text: '#1D1D1F',
  line: '#E5E5EA',
  primary: '#007AFF',
};

export function AreaFilterChips({
  projectAreas,
  areaFilterId,
  onChangeAreaFilter,
}: AreaFilterChipsProps) {
  return (
    <View style={styles.areaChipWrap}>
      <TouchableOpacity
        style={[
          styles.areaChip,
          !areaFilterId && styles.areaChipSelected,
        ]}
        onPress={() => onChangeAreaFilter(null)}
      >
        <Text
          style={[
            styles.areaChipText,
            !areaFilterId && styles.areaChipTextSelected,
          ]}
        >
          All Areas
        </Text>
      </TouchableOpacity>

      {projectAreas.map(area => {
        const selected = areaFilterId === area.id;

        return (
          <TouchableOpacity
            key={area.id}
            style={[
              styles.areaChip,
              selected && styles.areaChipSelected,
            ]}
            onPress={() => onChangeAreaFilter(area.id)}
          >
            <Text
              style={[
                styles.areaChipText,
                selected && styles.areaChipTextSelected,
              ]}
            >
              {area.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  areaChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  areaChip: {
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },

  areaChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  areaChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },

  areaChipTextSelected: {
    color: '#FFFFFF',
  },
});
