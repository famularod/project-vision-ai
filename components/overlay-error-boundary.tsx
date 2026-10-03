import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert } from 'react-native';

import { logStartupDiagnostic, startupErrorMessage } from '../services/StartupDiagnostics';
import type { AppScreen } from '../types/app-navigation';

type Props = {
  screen: AppScreen;
  /** Closes every sheet and modal; their open state lives outside this boundary. */
  onError: () => void;
  children: ReactNode;
};

type State = { failed: boolean; retried: boolean; screen: AppScreen };

/**
 * Keeps a sheet's or modal's render error away from the screen (whole-app
 * audit A2 pass 2, 30 Sep 2026). The screen boundary also caught the app's
 * sheets, whose open state lives in App, so a sheet that threw while open
 * threw again after Try Again, Overview, Settings and every tab, until the
 * app was force-quit. On an error every sheet is closed and the overlays
 * render once more; if they throw again with everything closed (bad saved
 * data read even while closed), they stay empty until the screen changes.
 * The screen underneath is never touched.
 */
export class OverlayErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, retried: false, screen: this.props.screen };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.screen === state.screen) return null;
    return { screen: props.screen, failed: false, retried: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logStartupDiagnostic('error_boundary_caught', startupErrorMessage(error), {
      scope: 'overlay',
      screen: this.props.screen,
      retried: this.state.retried,
      componentStack: info.componentStack ? info.componentStack.slice(0, 180) : null,
    });
    if (this.state.retried) return;
    this.props.onError();
    Alert.alert('That panel could not open.', 'It was closed. Your saved project data is safe.');
    this.setState({ failed: false, retried: true });
  }

  componentDidUpdate() {
    // Rendered cleanly after closing: a later panel fault gets the same recovery.
    if (!this.state.failed && this.state.retried) this.setState({ retried: false });
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
