import { Ionicons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import {
  FlatList,
  Image,
  StyleProp,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { ActionItemsCard } from './ActionItemsCard';
import {
  EmptyState,
  PrimaryButton,
  ProjectUpdate,
  UpdatePhoto,
  colors,
  isActionCategory,
  styles,
} from './ProjectDetailsCard';
import { SafetyCard } from './SafetyCard';

export function PhotoGallery({
  contentStyle,
  update,
  header,
  onUpdatePhoto,
  onRemovePhoto,
  onMovePhoto,
  onPreviewPhoto,
  onNext,
}: {
  contentStyle: StyleProp<ViewStyle>;
  update: ProjectUpdate;
  header: ReactElement;
  onUpdatePhoto: (
    photoId: string,
    next: Partial<UpdatePhoto>,
  ) => void;
  onRemovePhoto: (photoId: string) => void;
  onMovePhoto: (
    photoId: string,
    direction: 'up' | 'down',
  ) => void;
  onPreviewPhoto: (photo: UpdatePhoto) => void;
  onNext: () => void;
}) {
  const renderPhoto = ({
    item: photo,
    index,
  }: {
    item: UpdatePhoto;
    index: number;
  }) => (
    <PhotoCard
      photo={photo}
      index={index}
      onUpdate={next =>
        onUpdatePhoto(photo.id, next)
      }
      onRemove={() =>
        onRemovePhoto(photo.id)
      }
      onMoveUp={() =>
        onMovePhoto(photo.id, 'up')
      }
      onMoveDown={() =>
        onMovePhoto(photo.id, 'down')
      }
      onPreview={() =>
        onPreviewPhoto(photo)
      }
      canMoveUp={index > 0}
      canMoveDown={
        index < update.photos.length - 1
      }
    />
  );

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={update.photos}
      keyExtractor={photo => photo.id}
      renderItem={renderPhoto}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <EmptyState
          title="No photos yet"
          text="Add photos, or continue without photos and write the update notes."
        />
      }
      ListFooterComponent={
        <PrimaryButton
          label={
            update.photos.length === 0
              ? 'Continue Without Photos'
              : 'Build Update'
          }
          icon="document-text-outline"
          onPress={onNext}
        />
      }
    />
  );
}

function PhotoCard({
  photo,
  index,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onPreview,
  canMoveUp,
  canMoveDown,
}: {
  photo: UpdatePhoto;
  index: number;
  onUpdate: (
    next: Partial<UpdatePhoto>,
  ) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPreview: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <View style={styles.photoCard}>
      <View style={styles.photoHeader}>
        <TouchableOpacity
          onPress={onPreview}
          accessibilityLabel={`Preview photo ${index + 1}`}
        >
          <Image
            source={{ uri: photo.uri }}
            style={styles.photoThumb}
          />

          <View style={styles.photoPreviewBadge}>
            <Ionicons
              name="expand-outline"
              size={13}
              color="#FFFFFF"
            />
          </View>
        </TouchableOpacity>

        <View style={styles.photoMeta}>
          <Text style={styles.photoTitle}>
            Photo {index + 1}
          </Text>

          <Text style={styles.bodyText}>
            {photo.caption.trim()
              ? 'Ready for update'
              : 'Needs field note'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.iconOnlyDangerButton}
          onPress={onRemove}
        >
          <Ionicons
            name="trash-outline"
            size={19}
            color={colors.danger}
          />
        </TouchableOpacity>
      </View>

      <SafetyCard
        photo={photo}
        onUpdate={onUpdate}
      />

      <Text style={styles.label}>
        Field note
      </Text>

      <TextInput
        style={styles.input}
        value={photo.caption}
        onChangeText={caption =>
          onUpdate({ caption })
        }
        placeholder="Example: Concrete transition area completed."
        placeholderTextColor={colors.muted}
        multiline
      />

      {isActionCategory(photo.category) ? (
        <ActionItemsCard
          photo={photo}
          onUpdate={onUpdate}
        />
      ) : null}

      <View style={styles.photoControlRow}>
        <TouchableOpacity
          style={styles.photoControlButton}
          onPress={onPreview}
        >
          <Ionicons
            name="expand-outline"
            size={17}
            color={colors.primary}
          />

          <Text style={styles.photoControlText}>
            View
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.photoControlButton,
            !canMoveUp &&
              styles.photoControlButtonDisabled,
          ]}
          onPress={onMoveUp}
          disabled={!canMoveUp}
        >
          <Ionicons
            name="arrow-up-outline"
            size={17}
            color={
              canMoveUp
                ? colors.primary
                : colors.tertiaryText
            }
          />

          <Text
            style={[
              styles.photoControlText,
              !canMoveUp &&
                styles.photoControlTextDisabled,
            ]}
          >
            Up
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.photoControlButton,
            !canMoveDown &&
              styles.photoControlButtonDisabled,
          ]}
          onPress={onMoveDown}
          disabled={!canMoveDown}
        >
          <Ionicons
            name="arrow-down-outline"
            size={17}
            color={
              canMoveDown
                ? colors.primary
                : colors.tertiaryText
            }
          />

          <Text
            style={[
              styles.photoControlText,
              !canMoveDown &&
                styles.photoControlTextDisabled,
            ]}
          >
            Down
          </Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}
