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
          <Text style={styles.title}>
            Project Photo could not finish starting.
          </Text>

          <Text style={styles.body}>
            Your saved project data is still on this device. Try again, or open diagnostics after the app starts.
          </Text>

          <TouchableOpacity
            style={styles.button}
            onPress={this.retry}
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
    backgroundColor: '#F2F2F7',
  },
  title: {
    color: '#1D1D1F',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    marginBottom: 10,
  },
  body: {
    color: '#6E6E73',
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 18,
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
});
