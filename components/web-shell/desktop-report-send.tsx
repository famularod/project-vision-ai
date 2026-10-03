import { createElement, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import {
  UNSENT_APPROVAL_APPROVE_ANYWAY,
  UNSENT_APPROVAL_GO_BACK,
  UNSENT_APPROVAL_WARNING_TITLE,
  describeSendWindowTime,
  manualReportSendWindow,
  unsentApprovalWarning,
} from '../../services/ReportManualSend';
import { colors, spacing } from '../../theme';
import { desktopSurfaces } from './desktop-surface-palette';

/**
 * Owner answer 2 Oct (web sends count): the web Reports page's own send
 * questions. A share sheet or an email draft cannot say whether the report
 * went out, so David is asked (as the phone asks after Outlook), and a report
 * sent another way is recorded with Mark as Sent (as on the phone). Nothing
 * is recorded until he says so.
 */
/**
 * The approved report a share or an email draft was made from (review N1 M1,
 * 3 Oct 2026): the saved report and the revision its approval was saved as,
 * its facts, and the period (projects and format) it belongs to. "Was the
 * report sent?" is about this report only.
 */
export type DesktopSharedReport = Readonly<{
  reportId: string;
  revision: string | null;
  fingerprint: string | null;
  scopeKey: string;
  reportFormat: 'project_manager' | 'executive';
}>;

/** Whether the report on screen is still the approval that was shared. */
export function sameSharedReport(shared: DesktopSharedReport, onScreen: DesktopSharedReport): boolean {
  return shared.reportId === onScreen.reportId &&
    shared.revision === onScreen.revision &&
    shared.fingerprint === onScreen.fingerprint &&
    shared.scopeKey === onScreen.scopeKey &&
    shared.reportFormat === onScreen.reportFormat;
}

/**
 * Where the next report runs from once a send is recorded (review N1, 3 Oct
 * 2026): every device when reports are shared between them (owner answer
 * Q16); before that, this computer only. The panels said "every device"
 * either way.
 */
function nextReportRunsOn(sharedBetweenDevices: boolean): string {
  return sharedBetweenDevices ? 'on every device' : 'on this computer';
}

export function DesktopReportSentQuestion({
  pending,
  onAnswer,
  sharedBetweenDevices = true,
}: {
  pending: boolean;
  onAnswer: (sent: boolean) => void;
  /** False before the shared record exists: a send from here is this computer's own period. */
  sharedBetweenDevices?: boolean;
}) {
  return (
    <View style={styles.panel} accessibilityLabel="Was the report sent?">
      <Text style={styles.title}>Was the report sent?</Text>
      <Text style={styles.detail}>
        {`If you sent it, the next report ${nextReportRunsOn(sharedBetweenDevices)} runs from this one. If not, nothing is recorded: once you send it, use Mark as Sent.`}
      </Text>
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pending && styles.disabled, pressed && styles.pressed]}
          onPress={() => onAnswer(true)}
          disabled={pending}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>Yes, it was sent</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={() => onAnswer(false)}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Not yet</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Review N1 L5 (3 Oct 2026): Approve would replace an approved report this
 * computer has not recorded as sent, and only the newest approval can be
 * marked sent. He is told first, as on the phone, and can go back to Mark as
 * Sent.
 */
export function DesktopReportUnsentApprovalWarning({
  approval,
  pending,
  onApprove,
  onGoBack,
}: {
  approval: DAVEReportSnapshot;
  pending: boolean;
  onApprove: () => void;
  onGoBack: () => void;
}) {
  return (
    <View style={styles.panel} accessibilityRole="alert" accessibilityLabel={UNSENT_APPROVAL_WARNING_TITLE}>
      <Text style={styles.title}>{UNSENT_APPROVAL_WARNING_TITLE}</Text>
      <Text style={styles.detail}>{unsentApprovalWarning(approval)}</Text>
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={onGoBack}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>{UNSENT_APPROVAL_GO_BACK}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pending && styles.disabled, pressed && styles.pressed]}
          onPress={onApprove}
          disabled={pending}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>{UNSENT_APPROVAL_APPROVE_ANYWAY}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** "2026-10-01T16:30" in this computer's time zone, for a datetime-local field. */
function localDateTimeValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Mark as Sent for the approval this computer saved and has not recorded as sent (the phone's rules). */
export function DesktopReportMarkSent({
  approval,
  recording,
  message,
  onRecord,
  sharedBetweenDevices = true,
}: {
  approval: DAVEReportSnapshot;
  recording: boolean;
  message: string;
  onRecord: (choice: 'now' | Date) => void;
  /** False before the shared record exists: a send from here is this computer's own period. */
  sharedBetweenDevices?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState<'now' | 'earlier'>('now');
  const [picked, setPicked] = useState('');
  const sendWindow = manualReportSendWindow(approval);
  const factsAsOf = describeSendWindowTime(approval.capturedAt);

  if (!open) {
    return (
      <View style={styles.panel} accessibilityLabel="Sent it another way?">
        <Text style={styles.title}>Sent it another way?</Text>
        <Text style={styles.detail}>
          {`This approved report (project facts as of ${factsAsOf}) isn't recorded as sent. If you sent it from an email draft, ` +
            `the share menu or as the Word file, mark it sent so the next report ${nextReportRunsOn(sharedBetweenDevices)} runs from it.`}
        </Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={() => {
            setWhen('now');
            setPicked(localDateTimeValue(new Date().toISOString()));
            setOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Mark as Sent"
        >
          <Text style={styles.secondaryText}>Mark as Sent</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>When was it sent?</Text>
      <View style={styles.actions} accessibilityRole="radiogroup">
        {(['now', 'earlier'] as const).map(choice => (
          <Pressable
            key={choice}
            style={({ pressed }) => [styles.choice, when === choice && styles.choiceActive, pressed && styles.pressed]}
            onPress={() => setWhen(choice)}
            accessibilityRole="radio"
            accessibilityState={{ selected: when === choice }}
            accessibilityLabel={choice === 'now' ? 'Sent just now' : 'Sent earlier'}
          >
            <Text style={styles.choiceText}>{choice === 'now' ? 'Just now' : 'Earlier'}</Text>
          </Pressable>
        ))}
      </View>
      {when === 'earlier' ? (
        <>
          {createElement('input', {
            type: 'datetime-local',
            value: picked,
            min: sendWindow ? localDateTimeValue(sendWindow.earliest) : undefined,
            max: localDateTimeValue(new Date().toISOString()),
            onChange: (event: { target: { value: string } }) => setPicked(event.target.value),
            'aria-label': 'When the report was sent',
            'data-testid': 'report-mark-sent-time',
            style: { fontSize: 15, padding: 8, borderRadius: 8, border: `1px solid ${desktopSurfaces.border}` },
          })}
          <Text style={styles.detail}>{`Any time from ${factsAsOf}, when this report's project facts were current.`}</Text>
        </>
      ) : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Cancel marking as sent"
        >
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, recording && styles.disabled, pressed && styles.pressed]}
          onPress={() => onRecord(when === 'now' ? 'now' : new Date(picked))}
          disabled={recording}
          accessibilityRole="button"
          accessibilityLabel="Record as Sent"
        >
          <Text style={styles.primaryText}>Record as Sent</Text>
        </Pressable>
      </View>
      <Text style={styles.detail}>Nothing is sent from here: this only records that the approved report went out.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
  },
  title: { color: colors.text, fontSize: 15, fontWeight: '800' },
  detail: { color: colors.mutedText, fontSize: 13, lineHeight: 18 },
  message: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  choice: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  choiceActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  primaryButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
