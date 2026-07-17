import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme';
import type { AppScreen } from '../types/app-navigation';
import { AppBottomTabs } from './app-bottom-tabs';

export function AppShellFrame({
  children,
  currentScreen,
  onScreenChange,
  onTalk,
}: {
  children: ReactNode;
  currentScreen: AppScreen;
  onScreenChange: (screen: AppScreen) => void;
  onTalk: () => void;
}) {
  return (
    <SafeAreaView
      style={styles.shell}
      edges={['left', 'right', 'bottom']}
    >
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <View style={styles.appFrame}>
          {children}
          <AppBottomTabs
            current={currentScreen}
            onChange={onScreenChange}
            onTalk={onTalk}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboard: {
    flex: 1,
  },
  appFrame: {
    flex: 1,
  },
});
