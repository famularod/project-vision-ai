import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerRootComponent } from 'expo';
import { createElement, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import App from './App';
import { PendingChangesRetryBoundary } from './components/pending-changes-retry-boundary';
import {
  createOwnerStorageSandbox,
  type OwnerStorageSandboxError,
} from './services/OwnerStorageSandbox';
import {
  getCurrentSessionUser,
  subscribeToAuthStateChange,
} from './services/SupabaseService';
import { ownerWorkspaceAuthDecision } from './services/OwnerWorkspaceAuthDecision';

// Native keeps the established application entry and navigation controller.
// Metro resolves entry.web.ts on the browser platform instead.
function NativeRoot() {
  const sandbox = useMemo(
    () => createOwnerStorageSandbox({ storage: AsyncStorage }),
    [],
  );
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<
    | Readonly<{ status: 'loading' }>
    | Readonly<{ status: 'ready'; ownerId: string | null }>
    | Readonly<{ status: 'error'; message: string }>
  >({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let desiredOwnerId: string | null | undefined;
    let transitionQueue = Promise.resolve();

    function activate(ownerId: string | null) {
      if (desiredOwnerId === ownerId) return;
      desiredOwnerId = ownerId;
      if (active) setState({ status: 'loading' });
      transitionQueue = transitionQueue
        .then(() => sandbox.activateOwner(ownerId))
        .then(() => {
          if (!active || desiredOwnerId !== ownerId) return;
          setGeneration(value => value + 1);
          setState({ status: 'ready', ownerId });
        })
        .catch((error: OwnerStorageSandboxError | Error) => {
          if (!active) return;
          setState({
            status: 'error',
            message: error.message ||
              'Vitruvius could not safely open this account’s local data.',
          });
        });
    }

    const unsubscribe = subscribeToAuthStateChange((event, session) => {
      const decision = ownerWorkspaceAuthDecision(event, session?.user?.id);
      if (decision.action === 'activate') activate(decision.ownerId);
    });
    void getCurrentSessionUser().then(result => {
      if (!result.ok) {
        throw new Error(
          result.message || result.error ||
          'Vitruvius could not verify the signed-in account.',
        );
      }
      activate(result.data?.id || null);
    }).catch(error => {
      if (!active) return;
      setState({
        status: 'error',
        message: error instanceof Error
          ? error.message
          : 'Vitruvius could not verify the signed-in account.',
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [sandbox]);

  if (state.status === 'loading') {
    return createElement(
      View,
      { style: ownerBoundaryStyles.centered },
      createElement(ActivityIndicator, { size: 'large', color: '#0B67C2' }),
      createElement(
        Text,
        { style: ownerBoundaryStyles.title },
        'Opening your Vitruvius workspace…',
      ),
    );
  }
  if (state.status === 'error') {
    return createElement(
      View,
      { style: ownerBoundaryStyles.centered },
      createElement(
        Text,
        { style: ownerBoundaryStyles.title },
        'Workspace protection needs attention',
      ),
      createElement(
        Text,
        { style: ownerBoundaryStyles.message },
        state.message,
      ),
      createElement(
        Pressable,
        {
          accessibilityRole: 'button',
          onPress: () => {
            setState({ status: 'loading' });
            void getCurrentSessionUser().then(result => {
              if (!result.ok) {
                throw new Error(
                  result.message || result.error ||
                  'Vitruvius could not verify the signed-in account.',
                );
              }
              return sandbox.activateOwner(result.data?.id || null);
            }).then(result => {
              setGeneration(value => value + 1);
              setState({ status: 'ready', ownerId: result.ownerId });
            }).catch(error => {
              setState({
                status: 'error',
                message: error instanceof Error
                  ? error.message
                  : 'Vitruvius could not safely open this workspace.',
              });
            });
          },
          style: ownerBoundaryStyles.button,
        },
        createElement(Text, { style: ownerBoundaryStyles.buttonText }, 'Retry'),
      ),
    );
  }

  return createElement(
    PendingChangesRetryBoundary,
    {
      key: `owner-${state.ownerId || 'signed-out'}-${generation}`,
      children: createElement(App, {
        key: `app-${state.ownerId || 'signed-out'}-${generation}`,
      }),
    },
  );
}

const ownerBoundaryStyles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#F5F7FA',
  },
  title: {
    marginTop: 16,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: '#101828',
    textAlign: 'center',
  },
  message: {
    marginTop: 10,
    maxWidth: 420,
    fontSize: 16,
    lineHeight: 23,
    color: '#475467',
    textAlign: 'center',
  },
  button: {
    marginTop: 20,
    minHeight: 48,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#0B67C2',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

registerRootComponent(NativeRoot);
