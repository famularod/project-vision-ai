import { Text, View } from 'react-native';
import {
  PrimaryButton,
  SecondaryButton,
  styles,
} from './ProjectDetailsCard';

export function SaveUpdateBar({
  subject,
  body,
  onSendEmail,
  onSendText,
  onCopy,
  onSave,
  onEditPhotos,
}: {
  subject: string;
  body: string;
  onSendEmail: () => void;
  onSendText: () => void;
  onCopy: () => void;
  onSave: () => void;
  onEditPhotos: () => void;
}) {
  return (
    <>
      <PrimaryButton
        label="Save Update"
        icon="bookmark-outline"
        onPress={onSave}
      />

      <View style={styles.sendRow}>
        <SecondaryButton
          label="Email"
          icon="mail-outline"
          onPress={onSendEmail}
          compact
        />

        <SecondaryButton
          label="Text"
          icon="chatbubble-outline"
          onPress={onSendText}
          compact
        />
      </View>

      <View style={styles.sendRow}>
        <SecondaryButton
          label="Copy"
          icon="copy-outline"
          onPress={onCopy}
          compact
        />

        <SecondaryButton
          label="Edit Photos"
          icon="images-outline"
          onPress={onEditPhotos}
          compact
        />
      </View>

      <View style={styles.previewCard}>
        <Text style={styles.previewLabel}>
          Subject
        </Text>

        <Text style={styles.subjectText}>
          {subject}
        </Text>

        <View style={styles.divider} />

        <Text style={styles.previewLabel}>
          Body
        </Text>

        <Text style={styles.previewBody}>
          {body}
        </Text>
      </View>
    </>
  );
}
