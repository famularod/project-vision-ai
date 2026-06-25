import { StyleSheet, Text, View } from 'react-native';

const colors = {
  primary: '#007AFF',
  text: '#1D1D1F',
  muted: '#6E6E73',
};

export function AppHeader() {
  return (
    <View style={styles.headerCompact}>
      <Text style={styles.kicker}>
        Project Photo Update Tool
      </Text>

      <Text style={styles.title}>
        Dashboard
      </Text>

      <Text style={styles.subtitle}>
        What needs attention right now.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerCompact: {
    paddingTop: 10,
    paddingBottom: 14,
  },

  kicker: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },

  title: {
    color: colors.text,
    fontSize: 31,
    fontWeight: '800',
    lineHeight: 37,
  },

  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 7,
    fontWeight: '500',
  },
});
