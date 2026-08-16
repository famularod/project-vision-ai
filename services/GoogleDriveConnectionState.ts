import type { GoogleDriveDisconnectResult } from './GoogleDriveWebProvider';

export type GoogleDriveConnectionState = 'connected' | 'disconnected' | 'uncertain';

export function nextGoogleDriveConnectionState(
  current: GoogleDriveConnectionState,
  status: GoogleDriveDisconnectResult['status'],
): GoogleDriveConnectionState {
  if (status === 'local_disconnect') return 'uncertain';
  if (current === 'uncertain' && status === 'not_connected') return 'uncertain';
  return 'disconnected';
}

export function googleDriveDisconnectActionIsAvailable(
  state: GoogleDriveConnectionState,
): boolean {
  return state === 'connected';
}
