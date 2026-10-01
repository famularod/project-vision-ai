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
  signInRefreshNoAnswerMark,
  subscribeToAuthStateChange,
  type SavedSignInRefreshOptions,
} from './services/SupabaseService';
import { ownerWorkspaceAuthDecision } from './services/OwnerWorkspaceAuthDecision';
import {
  clearLatestTimeSeen,
  OFFLINE_LOOKUP_TIMEOUT_MS,
  offlineSignInRefusalMessage,
  savedSignInClockSetBack,
  SIGNAL_BACK_FINISHING_SIGN_IN,
  watchOfflineSignInGrace,
  workspaceOwnerAfterFailedLookup,
  workspaceOwnerWithClockSetBack,
} from './services/OfflineSignInGrace';
import { noteSignedInOwner } from './services/CloudOwnerBinding';

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
    | Readonly<{ status: 'loading'; message?: string }>
    | Readonly<{ status: 'ready'; ownerId: string | null; signInPending: boolean }>
    | Readonly<{ status: 'error'; message: string }>
  >({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let desiredOwnerId: string | null | undefined;
    let signInPending = false;
    let transitionQueue = Promise.resolve();
    let stopGraceWatch: (() => void) | null = null;

    function endGraceWatch() {
      stopGraceWatch?.();
      stopGraceWatch = null;
    }

    function activate(ownerId: string | null, pending = false, lastRefreshedAtMs?: number) {
      // An offline opening decided from the saved sign-in never overrides a
      // sign-in event that already chose the workspace: a refresh the server
      // rejected while the lookup ran has signed out, and A's workspace must
      // not reopen (auth security review, 30 Sep 2026). Nor does a lookup
      // that outlived its attempt (Retry started a new one).
      if (pending && (desiredOwnerId !== undefined || !active)) return;
      // Work queued meanwhile is this account's (whole-app audit A1 M3).
      if (pending && ownerId) noteSignedInOwner(ownerId);
      if (desiredOwnerId === ownerId) {
        // This owner's sign-in refreshed: "offline, sign-in pending" ends in
        // the open workspace, which is not reopened (owner answer Q13).
        if (!pending && signInPending) {
          signInPending = false;
          endGraceWatch();
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
      endGraceWatch();
      if (pending && ownerId) {
        // The 7 days are checked again on return to the foreground and every
        // minute while open offline (auth security review, 30 Sep 2026).
        stopGraceWatch = watchOfflineSignInGrace({
          ownerId,
          // The 7 days count from the launch read's last refresh even if the
          // saved sign-in cannot be read again while open (A1 pass 3 L3).
          lastRefreshedAtMs,
          onExpired: (reason, seenAtMs) => {
            if (!active || !signInPending || desiredOwnerId !== ownerId) return;
            // Today's lockout, as at launch after 7 days or with the clock
            // set back (A1 pass 2 #5), saying why (A1 pass 3 L4). The
            // workspace stays on the phone; a refresh when there is signal
            // reopens it, and a rejected one signs out.
            desiredOwnerId = undefined;
            signInPending = false;
            setState({ status: 'error', message: offlineSignInRefusalMessage(reason, seenAtMs) });
          },
        });
      }
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
      // The server answered: its token's time bounds the clock again (A1 pass 2 #5).
      if (event === 'TOKEN_REFRESHED' && decision.action === 'activate' && decision.ownerId) {
        void clearLatestTimeSeen(decision.ownerId);
      }
      if (decision.action !== 'activate') return;
      // A1 pass 4 L3: until this launch has decided, the saved sign-in's own
      // events (its token valid by the phone's clock, no server asked) open
      // nothing while the clock is earlier than a time this phone already
      // saw; the lookup below asks the server instead.
      const ownerId = decision.ownerId;
      if (ownerId && desiredOwnerId === undefined && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
        void savedSignInClockSetBack(ownerId).then(seenAtMs => {
          if (seenAtMs === null && active && desiredOwnerId === undefined) activate(ownerId);
        });
        return;
      }
      activate(ownerId);
    });
    // A1 pass 3 L1: with signal back after an earlier failure, the lookup
    // finishes the sign-in and says so, until a sign-in event decides.
    const lookupStillWanted = () => active && desiredOwnerId === undefined;
    // A1 pass 5 L3: the lookup's 8-second limit ends with this attempt.
    let endLookup: () => void = () => undefined;
    const lookupEnded = new Promise<void>(resolve => { endLookup = resolve; });
    void openSavedWorkspace(sandbox, {
      stillWanted: lookupStillWanted,
      onSignalBack: () => {
        if (lookupStillWanted()) setState({ status: 'loading', message: SIGNAL_BACK_FINISHING_SIGN_IN });
      },
    }, lookupEnded).then(owner => {
      activate(owner.ownerId, owner.signInPending, owner.lastRefreshedAtMs);
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
      endLookup();
      endGraceWatch();
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
        state.message ?? 'Opening your Vitruvius workspace…',
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
 * Q13); anything else keeps "Workspace protection needs attention", saying
 * why when there is no signal (A1 pass 2 #3). A refresh that got no answer
 * before this lookup began is not taken for no signal (A1 pass 3 L1). A
 * token valid by a clock earlier than a time this phone already saw is not
 * taken on that clock's word: the server's refresh decides (A1 pass 4 L3).
 */
async function openSavedWorkspace(
  sandbox: OwnerStorageSandbox,
  lookup: Pick<SavedSignInRefreshOptions, 'onSignalBack' | 'stillWanted'>,
  lookupEnded: Promise<void>,
): Promise<Readonly<{ ownerId: string | null; signInPending: boolean; lastRefreshedAtMs?: number }>> {
  const noAnswerMark = signInRefreshNoAnswerMark();
  const refreshOptions = { ...lookup, noAnswerMark };
  // A1 pass 5 L3: null when the lookup ran out (a refresh under way that
  // never answers, behind a captive portal).
  const result = await sessionUserWithin(OFFLINE_LOOKUP_TIMEOUT_MS, lookupEnded);
  let owner: Readonly<{ ownerId: string | null; signInPending: boolean; lastRefreshedAtMs?: number }>;
  if (result?.ok) {
    owner = { ownerId: result.data?.id || null, signInPending: false };
  } else {
    const offline = await workspaceOwnerAfterFailedLookup(
      () => sandbox.activeOwnerId(),
      undefined,
      // The refresh has had its 8 seconds: decided now, as if there were no
      // signal, unless it has already said more (a 5xx, A1 pass 4 L2).
      result ? undefined : 0,
      refreshOptions,
    );
    if (!offline || !('ownerId' in offline)) {
      throw new Error(
        (offline && offlineSignInRefusalMessage(offline.refused, offline.seenAtMs)) ||
        result?.message || result?.error ||
        'Vitruvius could not verify the signed-in account.',
      );
    }
    owner = offline;
  }
  // A1 pass 4 L3: a clock set back is not trusted with a token valid by it.
  // A1 pass 5 L1: checked once here, whichever way the lookup found the
  // sign-in valid. A slow Keychain at launch (the lookup gives up after
  // 1.5 s) sent it down the failed-lookup path, which took the token as
  // valid by the phone's clock and opened the workspace fully signed in.
  // "Offline, sign-in pending" was checked against the clock already.
  if (owner.signInPending || !owner.ownerId) return owner;
  const seenAtMs = await savedSignInClockSetBack(owner.ownerId);
  if (seenAtMs === null) return owner;
  const confirmed = await workspaceOwnerWithClockSetBack(seenAtMs, undefined, refreshOptions);
  if ('ownerId' in confirmed) return confirmed;
  throw new Error(offlineSignInRefusalMessage('clock', confirmed.seenAtMs));
}

/**
 * Whole-app audit A1 pass 5 L3: the startup session lookup, or null after
 * `timeoutMs`. At launch it gives up after 1.5 s while auth-js starts; on
 * Retry auth-js has started, and a refresh it sends behind a captive portal
 * kept "Opening your Vitruvius workspace…" until the phone's own request
 * timeout (about a minute), where launch decided after about 8 seconds.
 * Once `ended` (the attempt is over), the limit no longer runs.
 */
async function sessionUserWithin(
  timeoutMs: number,
  ended: Promise<void>,
): Promise<Awaited<ReturnType<typeof getCurrentSessionUser>> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  void ended.then(() => {
    if (timer) clearTimeout(timer);
  });
  try {
    return await Promise.race([
      getCurrentSessionUser(),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
