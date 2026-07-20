export type DesktopReadOnlyPage =
  | 'overview'
  | 'projects'
  | 'tasks'
  | 'evidence'
  | 'photos'
  | 'documents'
  | 'reports'
  | 'settings';

export type DesktopNavigationItem = {
  page: DesktopReadOnlyPage;
  label: string;
  href: '/' | '/projects' | '/tasks' | '/evidence' | '/photos' | '/documents' | '/reports' | '/settings';
};

export const desktopNavigationItems: readonly DesktopNavigationItem[] = Object.freeze([
  { page: 'overview', label: 'Overview', href: '/' },
  { page: 'projects', label: 'Projects', href: '/projects' },
  { page: 'tasks', label: 'Tasks & Schedule', href: '/tasks' },
  { page: 'evidence', label: 'DAVE Evidence', href: '/evidence' },
  { page: 'photos', label: 'Photos', href: '/photos' },
  { page: 'documents', label: 'Documents', href: '/documents' },
  { page: 'reports', label: 'Reports', href: '/reports' },
  { page: 'settings', label: 'Settings', href: '/settings' },
]);

export function desktopRouteIsActive(pathname: string, href: DesktopNavigationItem['href']) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
