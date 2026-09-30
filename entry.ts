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
  NativeWorkspaceOwnerContext,
  NativeWorkspaceSignInPendingContext,
} from './components/native-workspace-owner';
import { NativeSignInGate } from './components/native-sign-in-gate';
import {
  createOwnerStorageSandbox,
  type OwnerStorageSandbox,
  type OwnerStorageSandboxError,
} from './services/OwnerStorageSandbox';
import {
  getCurrentSessionUser,
  subscribeToAuthStateChange,
} from './services/SupabaseService';
import { ownerWorkspaceAuthDecision } from './services/OwnerWorkspaceAuthDecision';
import { workspaceOwnerAfterFailedLookup } from './services/OfflineSignInGrace';

// Native keeps the established application entry and navigation controller.
// Metro resolves entry.web.ts on the browser platform instead.
export function NativeRoot() {
  const sandbox = useMemo(
    () => createOwnerStorageSandbox({ storage: AsyncStorage }),
    [],
  );
  const [generation, setGeneration] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    | Readonly<{ status: 'loading' }>
    | Readonly<{ status: 'ready'; ownerId: string | null; signInPending: boolean }>
    | Readonly<{ status: 'error'; message: string }>
  >({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let desiredOwnerId: string | null | undefined;
    let signInPending = false;
    let transitionQueue = Promise.resolve();

    function activate(ownerId: string | null, pending = false) {
      if (desiredOwnerId === ownerId) {
        // This owner's sign-in refreshed: "offline, sign-in pending" ends in
        // the open workspace, which is not reopened (owner answer Q13).
        if (!pending && signInPending) {
          signInPending = false;
          if (active) {
            setState(current => current.status === 'ready'
              ? { ...current, signInPending: false }
              : current);
          }
        }
        return;
      }
      desiredOwnerId = ownerId;
      signInPending = pending;
      if (active) setState({ status: 'loading' });
      transitionQueue = transitionQueue
        .then(() => sandbox.activateOwner(ownerId))
        .then(() => {
          if (!active || desiredOwnerId !== ownerId) return;
          setGeneration(value => value + 1);
          setState({ status: 'ready', ownerId, signInPending });
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
    void openSavedWorkspace(sandbox).then(owner => {
      activate(owner.ownerId, owner.signInPending);
    }).catch(error => {
      // A sign-in event that already chose the workspace outranks a failed
      // lookup (a refresh the server rejects signs out while this fails).
      if (!active || desiredOwnerId !== undefined) return;
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
  }, [sandbox, attempt]);

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
            setAttempt(value => value + 1);
          },
          style: ownerBoundaryStyles.button,
        },
        createElement(Text, { style: ownerBoundaryStyles.buttonText }, 'Retry'),
      ),
    );
  }

  // Work is only created inside a signed-in owner workspace. A signed-out
  // workspace used to accept projects and updates that the next sign-in then
  // discarded; the owner chose to require sign-in instead.
  if (!state.ownerId) {
    return createElement(NativeSignInGate, { key: `sign-in-${generation}` });
  }

  return createElement(
    NativeWorkspaceOwnerContext.Provider,
    { value: state.ownerId },
    createElement(
      NativeWorkspaceSignInPendingContext.Provider,
      { value: state.signInPending },
      createElement(PendingChangesRetryBoundary, {
        key: `owner-${state.ownerId || 'signed-out'}-${generation}`,
        children: createElement(App, {
          key: `app-${state.ownerId || 'signed-out'}-${generation}`,
        }),
      }),
    ),
  );
}

/**
 * The account whose workspace opens at launch. When the saved sign-in cannot
 * refresh for lack of network, the workspace already open on this phone for
 * that same account opens, marked "offline, sign-in pending" (owner answer
 * Q13); anything else keeps "Workspace protection needs attention".
 */
async function openSavedWorkspace(
  sandbox: OwnerStorageSandbox,
): Promise<Readonly<{ ownerId: string | null; signInPending: boolean }>> {
  const result = await getCurrentSessionUser();
  if (result.ok) return { ownerId: result.data?.id || null, signInPending: false };
  const offline = await workspaceOwnerAfterFailedLookup(() => sandbox.activeOwnerId());
  if (offline) return offline;
  throw new Error(
    result.message || result.error ||
    'Vitruvius could not verify the signed-in account.',
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
