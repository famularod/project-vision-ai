export type DesktopReadOnlyPage =
  | 'overview'
  | 'projects'
  | 'tasks'
  | 'evidence'
  | 'documents'
  | 'reports';

export type DesktopNavigationItem = {
  page: DesktopReadOnlyPage;
  label: string;
  href: '/' | '/projects' | '/tasks' | '/evidence' | '/documents' | '/reports';
};

export const desktopNavigationItems: readonly DesktopNavigationItem[] = Object.freeze([
  { page: 'overview', label: 'Overview', href: '/' },
  { page: 'projects', label: 'Projects', href: '/projects' },
  { page: 'tasks', label: 'Tasks & Schedule', href: '/tasks' },
  { page: 'evidence', label: 'DAVE Evidence', href: '/evidence' },
  { page: 'documents', label: 'Documents', href: '/documents' },
  { page: 'reports', label: 'Reports', href: '/reports' },
]);

export function desktopRouteIsActive(pathname: string, href: DesktopNavigationItem['href']) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
