import { Ionicons } from '@expo/vector-icons';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { PIEAttentionState } from '../services/PIEAttentionEngine';

type PIEConductorCardProps = {
  attentionState: PIEAttentionState;
  greeting?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimaryAction: () => void;
  onSecondaryAction?: () => void;
};

export function PIEConductorCard({
  attentionState,
  greeting = 'Good morning David.',
  primaryLabel,
  secondaryLabel,
  onPrimaryAction,
  onSecondaryAction,
}: PIEConductorCardProps) {
  const reason = attentionState.primaryItem.reasons[0]?.summary ||
    attentionState.whyItMatters;
  const buttonLabel =
    primaryLabel || attentionState.recommendedAction.label || 'Continue';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconBadge}>
          <Ionicons
            name="sparkles-outline"
            size={22}
            color="#FFFFFF"
          />
        </View>

        <View style={styles.headerText}>
          <Text style={styles.greeting}>
            {greeting}
          </Text>

          <Text style={styles.pieMessage}>
            DAVE is guiding today’s attention.
          </Text>
        </View>
      </View>

      <Text style={styles.whatMatters}>
        {attentionState.whatMattersNow}
      </Text>

      <View style={styles.reasonBlock}>
        <Text style={styles.reasonLabel}>
          Reason
        </Text>

        <Text style={styles.reasonText}>
          {reason}
        </Text>
      </View>

      <Text style={styles.nextStep}>
        {attentionState.nextStep}
      </Text>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={onPrimaryAction}
          accessibilityRole="button"
          accessibilityLabel={buttonLabel}
        >
          <Text style={styles.primaryButtonText}>
            {buttonLabel}
          </Text>

          <Ionicons
            name="arrow-forward-outline"
            size={18}
            color="#FFFFFF"
          />
        </TouchableOpacity>

        {onSecondaryAction && secondaryLabel ? (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={onSecondaryAction}
            accessibilityRole="button"
            accessibilityLabel={secondaryLabel}
          >
            <Text style={styles.secondaryButtonText}>
              {secondaryLabel}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerText: {
    flex: 1,
    minWidth: 0,
  },

  greeting: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
  },

  pieMessage: {
    color: '#BFDBFE',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },

  whatMatters: {
    color: '#FFFFFF',
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '900',
  },

  reasonBlock: {
    borderLeftWidth: 3,
    borderLeftColor: '#60A5FA',
    paddingLeft: 10,
    gap: 3,
  },

  reasonLabel: {
    color: '#BFDBFE',
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  reasonText: {
    color: '#E5E7EB',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },

  nextStep: {
    color: '#D1D5DB',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },

  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
  },

  secondaryButton: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4B5563',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },

  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
});
