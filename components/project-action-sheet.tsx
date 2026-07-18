import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import {
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type IconName = keyof typeof Ionicons.glyphMap;

export function ProjectActionSheet({
  visible,
  title,
  children,
  onClose,
}: Readonly<{
  visible: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}>) {
  const dragResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      gesture.dy > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 52) onClose();
    },
  }), [onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.scrim} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.dragArea} {...dragResponder.panHandlers}>
            <View style={styles.handle} />
          </View>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
            >
              <Ionicons name="close-outline" size={22} color="#1D1D1F" />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function MoreOptionRow({
  label,
  icon,
  onPress,
}: Readonly<{ label: string; icon: IconName; onPress: () => void }>) {
  return (
    <TouchableOpacity
      style={styles.optionRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.iconBubble}>
        <Ionicons name={icon} size={20} color="#007AFF" />
      </View>
      <View style={styles.rowMain}><Text style={styles.optionText}>{label}</Text></View>
      <Ionicons name="chevron-forward" size={20} color="#6E6E73" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.34)' },
  sheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 28, borderColor: '#E5E5EA',
    borderWidth: 1, maxHeight: '82%',
  },
  dragArea: { minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  handle: {
    width: 42, height: 4, borderRadius: 999, backgroundColor: '#E5E5EA', alignSelf: 'center',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, marginBottom: 10,
  },
  title: { color: '#1D1D1F', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  closeButton: {
    width: 38, height: 38, borderRadius: 8, backgroundColor: '#F2F2F7',
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingTop: 2, paddingBottom: 8 },
  optionRow: {
    minHeight: 60, borderRadius: 8, borderColor: '#E5E5EA', borderWidth: 1,
    padding: 12, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  iconBubble: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: '#EAF4FF',
    alignItems: 'center', justifyContent: 'center',
  },
  rowMain: { flex: 1 },
  optionText: { color: '#1D1D1F', fontSize: 16, fontWeight: '700' },
});
