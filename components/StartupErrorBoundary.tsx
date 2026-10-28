import { Component, type ErrorInfo, type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  logStartupDiagnostic,
  startupErrorMessage,
} from '../services/StartupDiagnostics';
import { displayFontFamily } from '../theme/typography';

type StartupErrorBoundaryProps = {
  children: ReactNode;
};

type StartupErrorBoundaryState = {
  error: Error | null;
  retryKey: number;
};

export class StartupErrorBoundary extends Component<
  StartupErrorBoundaryProps,
  StartupErrorBoundaryState
> {
  state: StartupErrorBoundaryState = {
    error: null,
    retryKey: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<StartupErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logStartupDiagnostic(
      'error_boundary_caught',
      startupErrorMessage(error),
      {
        componentStack: info.componentStack ? info.componentStack.slice(0, 180) : null,
      },
    );
  }

  retry = () => {
    logStartupDiagnostic('retry_requested', 'User retried startup after a render failure.');
    this.setState(state => ({
      error: null,
      retryKey: state.retryKey + 1,
    }));
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          {/* Also shown for a crash mid-session, and diagnostics were not
              reachable from here (whole-app audit A2 M4). */}
          <Text style={styles.title} accessibilityRole="header">
            Vitruvius hit a problem.
          </Text>

          <Text style={styles.body}>
            Your saved project data is still on this device. Tap Retry. Please do not delete the app: that would remove work not yet synced.
          </Text>

          <TouchableOpacity
            style={styles.button}
            onPress={this.retry}
            accessibilityRole="button"
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View key={this.state.retryKey} style={styles.flex}>
        {this.props.children}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F3F1EC',
  },
  title: {
    color: '#1A1A18',
    fontSize: 25,
    fontFamily: displayFontFamily,
    lineHeight: 32,
    fontWeight: '400',
    marginBottom: 10,
  },
  body: {
    color: '#66645E',
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 18,
  },
  button: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F3A2E',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600',
  },
});
