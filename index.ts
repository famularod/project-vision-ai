import { registerRootComponent } from 'expo';

import App from './App';

// TEMPORARY loop diagnostic (2026-07-18): when React reports an infinite
// update loop, print every argument in full — including the component stack —
// to Metro, plus the JS stack at the moment of the report. Remove after the
// device loop is fixed.
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('Maximum update depth')) {
    originalConsoleError('[loop-diagnostic] full error args:');
    args.forEach((arg, index) => {
      originalConsoleError(`[loop-diagnostic] arg${index}:`, String(arg));
    });
    originalConsoleError(
      '[loop-diagnostic] js stack:',
      new Error('loop-diagnostic').stack,
    );
  }
  originalConsoleError(...args);
};

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
