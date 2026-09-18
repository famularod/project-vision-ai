jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/NEW-ID/Documents/',
  cacheDirectory: 'file:///var/mobile/Containers/Data/Application/NEW-ID/Library/Caches/',
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));
jest.mock('react-native', () => ({
  Image: { getSize: jest.fn() },
  NativeModules: {},
  Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
  TurboModuleRegistry: { get: jest.fn(() => null) },
}));
jest.mock('../../services/SupabaseService', () => ({
  getSupabaseClient: jest.fn(),
  getCurrentSessionAccessToken: jest.fn(),
}));

import * as FileSystem from 'expo-file-system/legacy';
import { relocateLocalPhotoUri } from '../../services/SyncService';
import type { UpdatePhoto } from '../../types';

const photo = (uri: string): UpdatePhoto => ({
  id: 'p1', uri, caption: '', category: 'Update', actionRequired: '', actionOwner: '',
  actionDueDate: '', actionStatus: 'Open', selectedAreaName: '',
});

describe('relocateLocalPhotoUri', () => {
  beforeEach(() => jest.resetAllMocks());

  it('finds a photo saved under an older app install folder', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, isDirectory: false, size: 1234 });
    const uri = await relocateLocalPhotoUri(photo(
      'file:///var/mobile/Containers/Data/Application/OLD-ID/Documents/project-photos/2375/cover.jpg',
    ));
    expect(uri).toBe('file:///var/mobile/Containers/Data/Application/NEW-ID/Documents/project-photos/2375/cover.jpg');
  });

  it('returns null when the file is not in the current folder either', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
    expect(await relocateLocalPhotoUri(photo(
      'file:///var/mobile/Containers/Data/Application/OLD-ID/Documents/project-photos/x.jpg',
    ))).toBeNull();
  });

  it('ignores remote and already-current paths', async () => {
    expect(await relocateLocalPhotoUri(photo('https://example.com/a.jpg'))).toBeNull();
    expect(await relocateLocalPhotoUri(photo(
      'file:///var/mobile/Containers/Data/Application/NEW-ID/Documents/project-photos/x.jpg',
    ))).toBeNull();
    expect(FileSystem.getInfoAsync).not.toHaveBeenCalled();
  });
});
