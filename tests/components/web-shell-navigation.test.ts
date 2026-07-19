import {
  desktopNavigationItems,
  desktopRouteIsActive,
} from '../../components/web-shell/desktop-navigation';

describe('desktop read-only navigation', () => {
  test('provides a unique URL for every pilot surface', () => {
    expect(desktopNavigationItems.map(item => item.href)).toEqual([
      '/',
      '/projects',
      '/tasks',
      '/evidence',
      '/documents',
      '/reports',
    ]);
    expect(new Set(desktopNavigationItems.map(item => item.href)).size).toBe(desktopNavigationItems.length);
  });

  test('marks only the overview route active at the root', () => {
    expect(desktopRouteIsActive('/', '/')).toBe(true);
    expect(desktopRouteIsActive('/projects', '/')).toBe(false);
  });

  test('keeps a section active for future record deep links', () => {
    expect(desktopRouteIsActive('/projects/project-123', '/projects')).toBe(true);
    expect(desktopRouteIsActive('/reports/report-456', '/reports')).toBe(true);
    expect(desktopRouteIsActive('/documents', '/reports')).toBe(false);
  });
});
