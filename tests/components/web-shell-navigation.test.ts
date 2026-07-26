import {
  desktopNavigationItems,
  desktopRouteIsActive,
  desktopWorkspaceLayout,
  desktopWorkspaceScopeKey,
} from '../../components/web-shell/desktop-navigation';

describe('desktop read-only navigation', () => {
  test('provides a unique URL for every pilot surface', () => {
    expect(desktopNavigationItems.map(item => item.href)).toEqual([
      '/',
      '/projects',
      '/tasks',
      '/schedule',
      '/evidence',
      '/photos',
      '/documents',
      '/reports',
      '/settings',
    ]);
    expect(new Set(desktopNavigationItems.map(item => item.href)).size).toBe(desktopNavigationItems.length);
  });

  test('uses Vitruvius navigation icons across every web surface', () => {
    expect(desktopNavigationItems.map(item => item.icon)).toEqual([
      'home-outline',
      'business-outline',
      'checkbox-outline',
      'calendar-outline',
      'pulse-outline',
      'images-outline',
      'folder-open-outline',
      'reader-outline',
      'settings-outline',
    ]);
  });

  test('uses consistent PM-facing navigation labels', () => {
    expect(desktopNavigationItems.find(item => item.page === 'tasks')?.label).toBe('Tasks');
    expect(desktopNavigationItems.find(item => item.page === 'schedule')?.label).toBe('Schedule');
    expect(desktopNavigationItems.find(item => item.page === 'evidence')?.label).toBe('Field Activity');
  });

  test('marks only the overview route active at the root', () => {
    expect(desktopRouteIsActive('/', '/')).toBe(true);
    expect(desktopRouteIsActive('/projects', '/')).toBe(false);
  });

  test('keeps a section active for future record deep links', () => {
    expect(desktopRouteIsActive('/projects/project-123', '/projects')).toBe(true);
    expect(desktopRouteIsActive('/reports/report-456', '/reports')).toBe(true);
    expect(desktopRouteIsActive('/documents', '/reports')).toBe(false);
    expect(desktopRouteIsActive('/settings', '/settings')).toBe(true);
  });

  test('gives each page and selected project an isolated editor workspace', () => {
    expect(desktopWorkspaceScopeKey('tasks', '2375 Compliance Project')).toBe(
      'tasks:2375 compliance project',
    );
    expect(desktopWorkspaceScopeKey('tasks', '2321 Compliance Project')).not.toBe(
      desktopWorkspaceScopeKey('tasks', '2375 Compliance Project'),
    );
    expect(desktopWorkspaceScopeKey('documents', null)).toBe('documents:all-projects');
    expect(desktopWorkspaceScopeKey('reports', null)).not.toBe(
      desktopWorkspaceScopeKey('documents', null),
    );
  });

  test.each([320, 375, 390])(
    'uses the compact, non-sidebar layout at %ipx',
    width => {
      expect(desktopWorkspaceLayout(width)).toEqual({
        usesSidebar: false,
        compactContent: true,
      });
    },
  );

  test('reserves the sidebar for full desktop widths', () => {
    expect(desktopWorkspaceLayout(899).usesSidebar).toBe(false);
    expect(desktopWorkspaceLayout(900).usesSidebar).toBe(true);
  });
});
