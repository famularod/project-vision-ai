import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { DAVEAskEvidence } from '../services/DAVEAsk';
import type { ECOSDocumentEvidenceBinding } from '../services/ECOSDocumentEvidenceBinding';
import type { ReferenceDocument } from '../types';
import { colors, spacing } from '../theme';

export function ECOSDocumentEvidenceSheet({
  visible,
  evidence,
  document,
  imageUri,
  binding,
  loading,
  error,
  onOpenDocument,
  onClose,
}: {
  visible: boolean;
  evidence: DAVEAskEvidence | null;
  document: ReferenceDocument | null;
  imageUri: string | null;
  binding: ECOSDocumentEvidenceBinding | null;
  loading: boolean;
  error: string | null;
  onOpenDocument: () => void;
  onClose: () => void;
}) {
  const citation = evidence?.documentCitation;
  const hostedRegion = binding?.proofMode === 'hosted_cited_region';
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.main}>
              <Text style={styles.eyebrow}>
                {hostedRegion ? 'ECOS SOURCE-BOUND PROOF' : 'ECOS VERIFIED SOURCE'}
              </Text>
              <Text style={styles.title}>Document Evidence</Text>
              <Text style={styles.subtitle}>{citation?.label || document?.name || 'Project document'}</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel="Close document evidence">
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {loading ? (
              <View style={styles.loadingCard}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.loadingText}>Preparing the cited page area…</Text>
              </View>
            ) : null}
            {imageUri ? (
              <View style={styles.imageCard}>
                <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {evidence?.excerpt ? (
              <View style={styles.excerptCard}>
                <Text style={styles.label}>Cited text</Text>
                <Text style={styles.excerpt}>{evidence.excerpt}</Text>
              </View>
            ) : null}
            {binding?.exact ? (
              <View style={styles.assuranceCard}>
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
                <Text style={styles.assuranceText}>
                  {hostedRegion
                    ? 'ECOS matched this citation to the exact current project, file, revision, page, evidence version, and hosted drawing region before showing it.'
                    : 'ECOS matched this text to the exact stored region in the current document revision before showing it.'}
                </Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={onOpenDocument}
              disabled={!document || !binding?.exact || loading}
              accessibilityRole="button"
            >
              <Ionicons name="document-text-outline" size={20} color="#FFF" />
              <Text style={styles.primaryText}>Open Full Document</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(16,24,40,0.4)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginTop: 9 },
  header: { padding: spacing.lg, paddingBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  main: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', marginTop: 3 },
  subtitle: { color: colors.mutedText, fontSize: 13, marginTop: 4 },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 38, gap: spacing.md },
  loadingCard: { minHeight: 110, borderRadius: 16, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { color: colors.mutedText, fontSize: 14, fontWeight: '700' },
  imageCard: { minHeight: 220, maxHeight: 430, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFF', overflow: 'hidden' },
  image: { width: '100%', height: 360 },
  excerptCard: { borderRadius: 16, backgroundColor: colors.surfaceMuted, padding: spacing.md },
  label: { color: colors.text, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', marginBottom: spacing.xs },
  excerpt: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '700' },
  assuranceCard: { flexDirection: 'row', gap: spacing.sm, borderRadius: 14, backgroundColor: colors.primarySoft, padding: spacing.md },
  assuranceText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  primaryButton: { minHeight: 54, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm },
  primaryText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
});
