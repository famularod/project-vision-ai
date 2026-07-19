jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {},
}));

import { isStartupHydrationReady } from '../../hooks/use-startup-hydration';

describe('startup hydration readiness', () => {
  it('opens only after every required local domain is loaded', () => {
    expect(isStartupHydrationReady([true, true], [])).toBe(true);
    expect(isStartupHydrationReady([true, false], [])).toBe(false);
  });

  it('fails closed when a required local read fails after an earlier success', () => {
    expect(isStartupHydrationReady([true, true], [{
      state: 'read_failed',
      key: 'saved-updates',
      label: 'saved updates',
      error: 'storage unavailable',
    }])).toBe(false);
  });
});
