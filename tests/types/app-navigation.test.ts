import {
  APP_SCREEN_PATHS,
  appPathForScreen,
  type AppScreen,
} from '../../types/app-navigation';

describe('application route contract', () => {
  it('gives every application screen one stable future route', () => {
    const screens = Object.keys(APP_SCREEN_PATHS) as AppScreen[];
    const uniquePaths = new Set(Object.values(APP_SCREEN_PATHS));

    expect(screens).toHaveLength(13);
    expect(uniquePaths.size).toBe(screens.length);
    expect(appPathForScreen('Home')).toBe('/');
    expect(appPathForScreen('Schedule')).toBe('/tasks');
    expect(appPathForScreen('Reports')).toBe('/reports');
  });
});
