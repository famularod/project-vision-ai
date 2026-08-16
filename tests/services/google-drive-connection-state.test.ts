import {
  googleDriveDisconnectActionIsAvailable,
  nextGoogleDriveConnectionState,
} from '../../services/GoogleDriveConnectionState';

describe('Google Drive connection state authority', () => {
  it('preserves an unconfirmed remote-revocation warning when no local token remains', () => {
    expect(nextGoogleDriveConnectionState('uncertain', 'not_connected')).toBe('uncertain');
    expect(googleDriveDisconnectActionIsAvailable('uncertain')).toBe(false);
  });

  it('only reports disconnected after a confirmed revocation or an initially empty session', () => {
    expect(nextGoogleDriveConnectionState('connected', 'disconnected')).toBe('disconnected');
    expect(nextGoogleDriveConnectionState('connected', 'not_connected')).toBe('disconnected');
    expect(nextGoogleDriveConnectionState('connected', 'local_disconnect')).toBe('uncertain');
    expect(googleDriveDisconnectActionIsAvailable('connected')).toBe(true);
    expect(googleDriveDisconnectActionIsAvailable('disconnected')).toBe(false);
  });
});
