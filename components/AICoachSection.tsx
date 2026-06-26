import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

const colors = {
  text: '#1D1D1F',
  muted: '#6E6E73',
};

export function AICoachSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>
        {title}
      </Text>

      <Text style={styles.sectionSubtitle}>
        {subtitle}
      </Text>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 14,
  },

  sectionLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  sectionSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 10,
  },
});
