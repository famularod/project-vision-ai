import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function NotFoundRoute() {
  return (
    <View style={styles.root}>
      <Text style={styles.title} accessibilityRole="header">Page not found</Text>
      <Text style={styles.detail}>This browser route is not part of the approved read-only pilot.</Text>
      <Link href="/" asChild>
        <Pressable style={styles.button} accessibilityRole="link">
          <Text style={styles.buttonText}>Return to Overview</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F5F9', padding: 32, gap: 14 },
  title: { color: '#171A21', fontSize: 32, fontWeight: '900' },
  detail: { color: '#666D79', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  button: { minHeight: 48, borderRadius: 12, backgroundColor: '#087EF5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
});
