import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { displayFontFamily } from '../theme/typography';

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
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F1EC', padding: 32, gap: 14 },
  title: { color: '#1A1A18', fontSize: 37, fontFamily: displayFontFamily, fontWeight: '400' },
  detail: { color: '#66645E', fontSize: 17, lineHeight: 26, textAlign: 'center' },
  button: { minHeight: 48, borderRadius: 8, backgroundColor: '#1F3A2E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
