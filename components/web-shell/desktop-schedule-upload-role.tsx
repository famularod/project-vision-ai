import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DAVE_WEB_SCHEDULE_ROLE_CHOICES } from '../../services/DAVEWebOperations';
import type { ScheduleImportRole, ScheduleImportRoleSuggestion } from '../../services/ScheduleLookahead';
import { spacing } from '../../theme';
import { desktopSurfaces } from './desktop-surface-palette';

/**
 * Open item, web batch WS1 item 2 (medium; 6 Oct 2026): "How should Vitruvius
 * use this schedule?" in the web's "Review before upload", the question the
 * phone's import review asks (owner answer Q22). The web could only upload a
 * full schedule; a lookahead had to be imported on the phone or iPad.
 *
 * The choice selected at first is the phone's own suggestion, with its
 * reason. "Lookahead" keeps the master: a task in both files shows once with
 * the lookahead's dates and progress, tasks only in the lookahead are added,
 * and a newer lookahead for the same project replaces an older one (owner
 * answer Q25).
 */
export function DesktopScheduleUploadRole({
  suggestion,
  chosen,
  disabled,
  onChoose,
}: {
  suggestion: ScheduleImportRoleSuggestion;
  /** What he picked, or null while the suggestion stands. */
  chosen: ScheduleImportRole | null;
  disabled: boolean;
  onChoose: (role: ScheduleImportRole) => void;
}) {
  const selected = chosen || suggestion.role;
  const suggested = DAVE_WEB_SCHEDULE_ROLE_CHOICES.find(choice => choice.role === suggestion.role);
  return (
    <View style={styles.card} accessibilityRole="radiogroup" accessibilityLabel="How should Vitruvius use this schedule?">
      <Text style={styles.title}>How should Vitruvius use this schedule?</Text>
      {DAVE_WEB_SCHEDULE_ROLE_CHOICES.map(choice => {
        const active = selected === choice.role;
        return (
          <Pressable
            key={choice.role}
            style={({ pressed }) => [styles.choice, active && styles.choiceSelected, (pressed || disabled) && styles.dimmed]}
            onPress={() => onChoose(choice.role)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={`${choice.title}. ${choice.detail}`}
            accessibilityState={{ checked: active, disabled }}
          >
            <Text style={[styles.mark, active && styles.markSelected]}>{active ? '●' : '○'}</Text>
            <View style={styles.choiceText}>
              <Text style={styles.choiceTitle}>{choice.title}</Text>
              <Text style={styles.choiceDetail}>{choice.detail}</Text>
            </View>
          </Pressable>
        );
      })}
      <Text style={styles.suggestion}>
        {`Suggested: ${suggested?.title || ''}, because ${suggestion.reason}. You can change this before uploading.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, padding: spacing.md, gap: spacing.sm },
  title: { color: desktopSurfaces.text, fontSize: 16, lineHeight: 22, fontWeight: '900' },
  choice: { minHeight: 64, borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.input, padding: spacing.sm, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  choiceSelected: { borderColor: desktopSurfaces.accent, borderWidth: 2, backgroundColor: desktopSurfaces.selected },
  dimmed: { opacity: 0.6 },
  mark: { color: desktopSurfaces.textMuted, fontSize: 18, lineHeight: 22 },
  markSelected: { color: desktopSurfaces.accent },
  choiceText: { flex: 1, minWidth: 0, gap: 2 },
  choiceTitle: { color: desktopSurfaces.text, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  choiceDetail: { color: desktopSurfaces.textMuted, fontSize: 14, lineHeight: 20 },
  suggestion: { color: desktopSurfaces.textMuted, fontSize: 13, lineHeight: 19 },
});
