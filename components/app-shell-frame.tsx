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
import { afterTextInputBlur } from './after-text-input-blur';
import { AppBottomTabs } from './app-bottom-tabs';
import { AppNavigationRail } from './app-navigation-rail';
import {
  appShellHidesSystemStatusBar,
  appShellLayoutForWidth,
  AppShellLayoutProvider,
} from './app-shell-layout';
import { ScreenErrorBoundary } from './screen-error-boundary';
import { VitruviusBrandLockup } from './vitruvius-brand-lockup';
import type {
  VitruviusAskEcosPilotControl,
  VitruviusBetaAudience,
} from '../services/VitruviusBetaAuthorization';

export function AppShellFrame({
  children,
  currentScreen,
  onScreenChange,
  onTalk,
  onAskECOS,
  audience = 'owner_internal',
  askEcosPilotControl = null,
  taskProjects,
  selectedTaskProject,
  onTaskProjectChange,
  updateProjects,
  selectedUpdateProject,
  onUpdateProjectChange,
  documentProjects,
  documentCount,
  selectedDocumentProject,
  onDocumentProjectChange,
}: {
  children: ReactNode;
  currentScreen: AppScreen;
  onScreenChange: (screen: AppScreen) => void;
  onTalk: () => void;
  onAskECOS?: () => void;
  audience?: VitruviusBetaAudience;
  askEcosPilotControl?: VitruviusAskEcosPilotControl | null;
  taskProjects?: string[];
  selectedTaskProject?: string | null;
  onTaskProjectChange?: (projectName: string | null) => void;
  updateProjects?: string[];
  selectedUpdateProject?: string | null;
  onUpdateProjectChange?: (projectName: string | null) => void;
  documentProjects?: string[];
  documentCount?: number;
  selectedDocumentProject?: string | null;
  onDocumentProjectChange?: (projectName: string | null) => void;
}) {
  const { width } = useWindowDimensions();
  const layout = appShellLayoutForWidth(width);
  // A field being typed saves before its screen goes (audit A2 M3).
  const changeScreen = (screen: AppScreen) => afterTextInputBlur(() => onScreenChange(screen));
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
                onChange={changeScreen}
                onTalk={onTalk}
                onAskECOS={onAskECOS}
                audience={audience}
                askEcosPilotControl={askEcosPilotControl}
                taskProjects={taskProjects}
                selectedTaskProject={selectedTaskProject}
                onTaskProjectChange={onTaskProjectChange && (projectName =>
                  // It switches the task inspector: an Owner being typed saves first (audit A2 pass 2 M2).
                  afterTextInputBlur(() => onTaskProjectChange(projectName)))}
                updateProjects={updateProjects}
                selectedUpdateProject={selectedUpdateProject}
                onUpdateProjectChange={onUpdateProjectChange}
                documentProjects={documentProjects}
                documentCount={documentCount}
                selectedDocumentProject={selectedDocumentProject}
                onDocumentProjectChange={onDocumentProjectChange}
              />
            ) : null}

            <View key="app-content" style={styles.contentFrame}>
              <ScreenErrorBoundary screen={currentScreen} onNavigate={onScreenChange}>
                {children}
              </ScreenErrorBoundary>
            </View>

            {layout.navigationPlacement === 'bottom' ? (
              <AppBottomTabs
                key="primary-navigation"
                current={currentScreen}
                onChange={changeScreen}
                onTalk={onTalk}
                onAskECOS={onAskECOS}
                audience={audience}
                askEcosPilotControl={askEcosPilotControl}
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
