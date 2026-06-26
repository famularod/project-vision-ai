import { Ionicons } from '@expo/vector-icons';
import { Image, Modal, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { UpdatePhoto } from '../types';
import { styles } from './ProjectDetailsCard';

export function PhotoPreviewModal({
  photo,
  onClose,
}: {
  photo: UpdatePhoto | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={Boolean(photo)}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.photoModalBackdrop}>
        <SafeAreaView style={styles.photoModalSafeArea}>
          <View style={styles.photoModalHeader}>
            <View style={styles.photoModalTitleWrap}>
              <Text style={styles.photoModalTitle}>
                Photo Preview
              </Text>

              {photo?.caption.trim() ? (
                <Text
                  style={styles.photoModalCaption}
                  numberOfLines={2}
                >
                  {photo.caption}
                </Text>
              ) : null}
            </View>

            <TouchableOpacity
              style={styles.photoModalCloseButton}
              onPress={onClose}
              accessibilityLabel="Close photo preview"
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            >
              <Ionicons
                name="close"
                size={30}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>

          {photo ? (
            <Image
              source={{ uri: photo.uri }}
              style={styles.photoModalImage}
              resizeMode="contain"
            />
          ) : null}

          <View style={styles.photoModalBottomBar}>
            <TouchableOpacity
              style={styles.photoModalBottomCloseButton}
              onPress={onClose}
              accessibilityLabel="Close photo preview"
            >
              <Ionicons
                name="close-circle-outline"
                size={22}
                color="#FFFFFF"
              />

              <Text style={styles.photoModalBottomCloseText}>
                Close Photo
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
