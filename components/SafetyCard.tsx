import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  CATEGORIES,
  CATEGORY_ICONS,
  colors,
  styles,
  UpdatePhoto,
} from './ProjectDetailsCard';

export function SafetyCard({
  photo,
  onUpdate,
}: {
  photo: UpdatePhoto;
  onUpdate: (
    next: Partial<UpdatePhoto>,
  ) => void;
}) {
  return (
    <>
      <Text style={styles.label}>
        Category
      </Text>

      <View style={styles.categoryGrid}>
        {CATEGORIES.map(category => (
          <TouchableOpacity
            key={category}
            style={[
              styles.categoryChip,
              photo.category === category &&
                styles.categoryChipActive,
            ]}
            onPress={() =>
              onUpdate({ category })
            }
          >
            <Ionicons
              name={CATEGORY_ICONS[category]}
              size={15}
              color={
                photo.category === category
                  ? '#FFFFFF'
                  : colors.primary
              }
            />

            <Text
              style={[
                styles.categoryText,
                photo.category === category &&
                  styles.categoryTextActive,
              ]}
            >
              {category}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}
