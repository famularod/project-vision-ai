import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { logStartupDiagnostic, startupErrorMessage } from '../services/StartupDiagnostics';
import { colors } from '../theme';
import type { AppScreen } from '../types/app-navigation';

type Props = {
  screen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  children: ReactNode;
};

type State = { error: Error | null; screen: AppScreen; retryKey: number };

/**
 * Keeps a screen's render error inside the content area (whole-app audit A2
 * M4, 30 Sep 2026). The only boundary was at the root, so one throwing screen
 * replaced the whole app, tab bar included, and a fault on Overview crashed
 * again on every Retry and relaunch, with Settings and backup export out of
 * reach (Settings opens only from Overview). The tab bar and rail stay; the
 * fallback offers Try Again, Overview and Settings. Leaving the screen clears
 * the error; ordinary navigation remounts nothing.
 */
export class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { error: null, screen: this.props.screen, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.screen === state.screen) return null;
    return { screen: props.screen, error: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logStartupDiagnostic('error_boundary_caught', startupErrorMessage(error), {
      scope: 'screen',
      screen: this.props.screen,
      componentStack: info.componentStack ? info.componentStack.slice(0, 180) : null,
    });
  }

  retry = () => this.setState(state => ({ error: null, retryKey: state.retryKey + 1 }));

  render() {
    const { error, retryKey } = this.state;
    const { screen, onNavigate } = this.props;
    if (!error) {
      return <View key={retryKey} style={styles.flex}>{this.props.children}</View>;
    }
    return (
      <View style={styles.container} testID="screen-error-fallback">
        <Text style={styles.title} accessibilityRole="header">This screen could not open.</Text>
        <Text style={styles.body}>
          Your saved project data is still on this device, and the rest of the app still works.
        </Text>
        <Action label="Try Again" onPress={this.retry} />
        {screen !== 'Home' ? <Action label="Back to Overview" onPress={() => onNavigate('Home')} /> : null}
        {screen !== 'Admin' ? <Action label="Open Settings" onPress={() => onNavigate('Admin')} /> : null}
      </View>
    );
  }
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.button}
      onPress={onPress}
      accessibilityRole="button"
      activeOpacity={0.85}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 10 },
  title: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 16, lineHeight: 23, marginBottom: 8 },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  buttonText: { color: colors.surface, fontSize: 16, lineHeight: 22, fontWeight: '800' },
});
