import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme';
import type { AppScreen } from '../types/app-navigation';
import { AppBottomTabs } from './app-bottom-tabs';
import { AppNavigationRail } from './app-navigation-rail';
import {
  appShellHidesSystemStatusBar,
  appShellLayoutForWidth,
  AppShellLayoutProvider,
} from './app-shell-layout';
import { VitruviusBrandLockup } from './vitruvius-brand-lockup';

export function AppShellFrame({
  children,
  currentScreen,
  onScreenChange,
  onTalk,
  taskProjects,
  selectedTaskProject,
  onTaskProjectChange,
  updateProjects,
  selectedUpdateProject,
  onUpdateProjectChange,
  documentProjects,
  selectedDocumentProject,
  onDocumentProjectChange,
}: {
  children: ReactNode;
  currentScreen: AppScreen;
  onScreenChange: (screen: AppScreen) => void;
  onTalk: () => void;
  taskProjects?: string[];
  selectedTaskProject?: string | null;
  onTaskProjectChange?: (projectName: string | null) => void;
  updateProjects?: string[];
  selectedUpdateProject?: string | null;
  onUpdateProjectChange?: (projectName: string | null) => void;
  documentProjects?: string[];
  selectedDocumentProject?: string | null;
  onDocumentProjectChange?: (projectName: string | null) => void;
}) {
  const { width } = useWindowDimensions();
  const layout = appShellLayoutForWidth(width);
  const hideSystemStatusBar = appShellHidesSystemStatusBar({
    layout,
    platform: process.env.EXPO_OS,
  });

  return (
    <AppShellLayoutProvider layout={layout}>
      <SafeAreaView
        style={styles.shell}
        edges={['left', 'right', 'bottom']}
      >
        <StatusBar hidden={hideSystemStatusBar} style="dark" />
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          <View
            style={[
              styles.appFrame,
              layout.navigationPlacement === 'rail' && styles.appFrameWithRail,
            ]}
          >
            {layout.navigationPlacement === 'bottom' ? (
              <SafeAreaView
                edges={['top']}
                style={styles.compactBrandHeader}
                testID="app-brand-header"
              >
                <VitruviusBrandLockup compact testID="app-brand-lockup" />
              </SafeAreaView>
            ) : null}

            {layout.navigationPlacement === 'rail' ? (
              <AppNavigationRail
                key="primary-navigation"
                current={currentScreen}
                expanded={layout.expandedRail}
                onChange={onScreenChange}
                onTalk={onTalk}
                taskProjects={taskProjects}
                selectedTaskProject={selectedTaskProject}
                onTaskProjectChange={onTaskProjectChange}
                updateProjects={updateProjects}
                selectedUpdateProject={selectedUpdateProject}
                onUpdateProjectChange={onUpdateProjectChange}
                documentProjects={documentProjects}
                selectedDocumentProject={selectedDocumentProject}
                onDocumentProjectChange={onDocumentProjectChange}
              />
            ) : null}

            <View key="app-content" style={styles.contentFrame}>
              {children}
            </View>

            {layout.navigationPlacement === 'bottom' ? (
              <AppBottomTabs
                key="primary-navigation"
                current={currentScreen}
                onChange={onScreenChange}
                onTalk={onTalk}
              />
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AppShellLayoutProvider>
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
  appFrameWithRail: {
    flexDirection: 'row',
  },
  compactBrandHeader: {
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#D5E2F0',
    borderBottomWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 10,
  },
  contentFrame: {
    flex: 1,
    minWidth: 0,
  },
});
