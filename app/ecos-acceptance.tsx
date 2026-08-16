import { StyleSheet, Text, View } from 'react-native';

export default function ECOSAcceptanceAuthorizationPage() {
  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>ECOS ASSURANCE</Text>
        <Text style={styles.title}>Validation authorization unavailable</Text>
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          Browser session handoff is disabled. Run validation with an explicit local test token or test credentials.
        </Text>
        <Text style={styles.status}>No browser token was shared</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: 'center',
    backgroundColor: '#eef5ff',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#bfd5f4',
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 620,
    padding: 32,
    width: '100%',
  },
  eyebrow: {
    color: '#087cf0',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: {
    color: '#151924',
    fontSize: 30,
    fontWeight: '800',
    marginTop: 12,
  },
  message: {
    color: '#526176',
    fontSize: 17,
    lineHeight: 26,
    marginTop: 18,
  },
  status: {
    color: '#b42318',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 22,
  },
});
