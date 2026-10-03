import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { PIEScheduleImportBatch } from '../services/PIEScheduleImportBatch';
import type { ScheduleImportPairingQuestion } from '../services/ScheduleImportMerge';
import { colors, spacing } from '../theme';
import type { ScheduleItem } from '../types';

/**
 * Owner answer Q30 (David, 2 Oct 2026): "YES, repeated task names within an
 * area. The import review asks him to confirm instead of guessing."
 *
 * One check per group of same-named tasks the file's dates cannot settle
 * (scheduleImportPairingQuestions): each saved task David sees, with its
 * dates, percent and note, beside the file's rows of that name, the app's
 * best guess selected. He picks the row each saved task is (or "Not in this
 * file") and confirms; a row no saved task takes comes in as a new task. His
 * answer decides the pairing, so the percent, notes and field-report links
 * follow it. Accept waits until every check is confirmed.
 */
export type ScheduleImportPairingAnswer = Readonly<{
  confirmed: boolean;
  /** Each saved task's row in this file, or null: not in this file. */
  rowOfSaved: Readonly<Record<string, string | null>>;
}>;

/** The app's best guess, not yet confirmed. */
export function scheduleImportPairingGuess(question: ScheduleImportPairingQuestion): ScheduleImportPairingAnswer {
  const rowOfSaved: Record<string, string | null> = Object.fromEntries(question.saved.map(item => [item.id, null]));
  Object.entries(question.guess).forEach(([rowId, savedId]) => { if (savedId && savedId in rowOfSaved) rowOfSaved[savedId] = rowId; });
  return { confirmed: false, rowOfSaved };
}

/** The answer with this saved task on this row (or none); another saved task on that row lets it go. */
export function scheduleImportPairingChosen(
  answer: ScheduleImportPairingAnswer,
  savedId: string,
  rowId: string | null,
): ScheduleImportPairingAnswer {
  const rowOfSaved = Object.fromEntries(Object.entries(answer.rowOfSaved)
    .map(([id, row]) => [id, id === savedId ? rowId : rowId && row === rowId ? null : row]));
  return { confirmed: true, rowOfSaved };
}

/** Why Accept waits, or null: a check David has not confirmed. */
export function scheduleImportPairingRefusal(
  questions: readonly ScheduleImportPairingQuestion[],
  answerOf: (question: ScheduleImportPairingQuestion) => ScheduleImportPairingAnswer,
): string | null {
  const open = questions.find(question => !answerOf(question).confirmed);
  return open ? `Confirm which ${open.taskName} is which in ${open.areaName || open.projectName} before saving.` : null;
}

/** The batch with David's answers: each row of a check to the saved task he chose, or null (a new task). */
export function withScheduleImportPairingChoices<T extends Pick<PIEScheduleImportBatch, 'pairingChoices'>>(
  batch: T,
  questions: readonly ScheduleImportPairingQuestion[],
  answerOf: (question: ScheduleImportPairingQuestion) => ScheduleImportPairingAnswer,
): T {
  if (questions.length === 0) return batch;
  const choices: Record<string, string | null> = { ...(batch.pairingChoices || {}) };
  questions.forEach(question => {
    const answer = answerOf(question);
    question.rows.forEach(row => {
      choices[row.id] = Object.entries(answer.rowOfSaved).find(([, rowId]) => rowId === row.id)?.[0] ?? null;
    });
  });
  return { ...batch, pairingChoices: choices };
}

function day(value: string): string {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : value.trim() || '—';
}

function datesOf(item: ScheduleItem): string {
  return `${day(item.startDate)}–${day(item.finishDate)}`;
}

function rowLabel(row: ScheduleItem): string {
  return row.percentCompleteStated === false ? `${datesOf(row)} · no %` : `${datesOf(row)} · ${row.percentComplete}%`;
}

function savedLabel(item: ScheduleItem): string {
  const note = item.notes?.trim();
  return `${datesOf(item)} · ${item.percentComplete}%${note ? ` · “${note.length > 60 ? `${note.slice(0, 59)}…` : note}”` : ''}`;
}

export function ScheduleImportPairingCheck({
  question,
  answer,
  disabled,
  onChange,
}: {
  question: ScheduleImportPairingQuestion;
  answer: ScheduleImportPairingAnswer;
  disabled: boolean;
  onChange: (answer: ScheduleImportPairingAnswer) => void;
}) {
  const taken = new Set(Object.values(answer.rowOfSaved).filter(Boolean));
  const added = question.rows.filter(row => !taken.has(row.id));
  return (
    <View style={styles.card} accessibilityRole="radiogroup" accessibilityLabel={question.title}>
      <View style={styles.header}>
        <Ionicons name="git-compare-outline" size={22} color={colors.warning} />
        <Text style={styles.title}>{question.title}</Text>
      </View>
      <Text style={styles.text}>
        The dates alone do not say which is which. For each saved task, pick its row in this file. The best guess is selected; its percent, notes and field reports go with your choice.
      </Text>
      {question.saved.map((item, index) => (
        <View key={item.id} style={styles.saved}>
          <Text style={styles.savedTitle}>{`Saved ${question.taskName} ${index + 1}: ${savedLabel(item)}`}</Text>
          {[...question.rows.map(row => ({ id: row.id as string | null, label: `This file: ${rowLabel(row)}` })), { id: null, label: 'Not in this file' }]
            .map(option => {
              const selected = (answer.rowOfSaved[item.id] ?? null) === option.id;
              return (
                <TouchableOpacity
                  key={option.id ?? 'none'}
                  style={[styles.option, selected && styles.optionSelected, disabled && styles.disabled]}
                  onPress={() => onChange(scheduleImportPairingChosen(answer, item.id, option.id))}
                  disabled={disabled}
                  accessibilityRole="radio"
                  accessibilityLabel={`Saved ${question.taskName} ${index + 1}, ${savedLabel(item)}: ${option.label}`}
                  accessibilityState={{ checked: selected, disabled }}
                >
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={colors.primary} />
                  <Text style={styles.optionText}>{option.label}</Text>
                </TouchableOpacity>
              );
            })}
        </View>
      ))}
      {added.length > 0 ? (
        <Text style={styles.text}>{`New ${question.taskName}: ${added.map(rowLabel).join('; ')}`}</Text>
      ) : null}
      <TouchableOpacity
        style={[styles.confirm, answer.confirmed && styles.confirmed, disabled && styles.disabled]}
        onPress={() => onChange({ ...answer, confirmed: true })}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={answer.confirmed ? `Confirmed: ${question.title}` : `Confirm: ${question.title}`}
        accessibilityState={{ disabled, selected: answer.confirmed }}
      >
        <Ionicons name={answer.confirmed ? 'checkmark-circle' : 'checkmark-circle-outline'} size={20} color={colors.primary} />
        <Text style={styles.confirmText}>{answer.confirmed ? 'Confirmed' : 'Confirm'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoft, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  saved: { gap: spacing.xs },
  savedTitle: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  option: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionSelected: { borderColor: colors.primary, borderWidth: 2 },
  optionText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 },
  confirm: { minHeight: 44, alignSelf: 'flex-start', borderRadius: 12, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  confirmed: { backgroundColor: colors.primarySoft },
  confirmText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.45 },
});
