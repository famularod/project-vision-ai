import { Stack } from 'expo-router/stack';
import { DesktopAuthProvider } from '../components/web-shell/desktop-auth-provider';

export default function RootLayout() {
  return (
    <DesktopAuthProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </DesktopAuthProvider>
  );
}
