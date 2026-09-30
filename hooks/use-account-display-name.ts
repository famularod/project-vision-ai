import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  accountDisplayNameForUser,
  getCurrentUser,
  updateCurrentUserDisplayName,
} from '../services/SupabaseService';

/**
 * The owner's display name at startup and when typed in Settings (whole-app
 * audit A2 M2, 30 Sep 2026). The workspace opens on the name saved on the
 * phone. It used to wait for the account lookup too, a network call that a
 * hung connection held for about a minute, and whose thrown error blocked the
 * app as unreadable phone storage. The lookup still runs (it also signs out a
 * session the server revoked); its name applies only to this workspace's
 * owner, and only while the name is untouched here. Only a typed name is
 * saved to the account: a name loaded from the phone may be older than one
 * set on the other device. Returns the Settings change handler.
 */
export function useAccountDisplayName({
  storageKey,
  retryAttempt,
  workspaceOwnerId,
  saveReady,
  displayName,
  setDisplayName,
  onLoaded,
  onFailed,
}: Readonly<{
  storageKey: string;
  retryAttempt: number;
  workspaceOwnerId: string | null;
  saveReady: boolean;
  displayName: string;
  setDisplayName: Dispatch<SetStateAction<string>>;
  onLoaded: () => void;
  onFailed: (error: unknown) => void;
}>): (name: string) => void {
  const typedRef = useRef(false);
  const callbacks = useRef({ onLoaded, onFailed });
  callbacks.current = { onLoaded, onFailed };

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey)
      .then(value => {
        if (!active) return;
        setDisplayName(current => current || value || '');
        callbacks.current.onLoaded();
      })
      .catch(error => {
        if (active) callbacks.current.onFailed(error);
      });
    getCurrentUser()
      .then(result => {
        const accountName = accountDisplayNameForUser(result.data);
        if (!active || !accountName || typedRef.current) return;
        if (!result.data || result.data.id !== workspaceOwnerId) return;
        setDisplayName(accountName);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [retryAttempt, setDisplayName, storageKey, workspaceOwnerId]);

  useEffect(() => {
    if (!saveReady || !typedRef.current || !displayName.trim()) return;
    const timer = setTimeout(() => {
      void updateCurrentUserDisplayName(displayName).catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [displayName, saveReady]);

  return name => {
    typedRef.current = true;
    setDisplayName(name);
  };
}
