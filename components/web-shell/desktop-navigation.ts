import {
  vitruviusAudienceCanAccessAskEcos,
  type VitruviusAskEcosPilotControl,
  type VitruviusBetaAudience,
} from '../../services/VitruviusBetaAuthorization';

export type DesktopReadOnlyPage =
  | 'overview'
  | 'projects'
  | 'tasks'
  | 'field-notes'
  | 'ask-ecos'
  | 'schedule'
  | 'evidence'
  | 'photos'
  | 'documents'
  | 'reports'
  | 'settings';

export type DesktopNavigationItem = {
  page: DesktopReadOnlyPage;
  label: string;
  icon: 'home-outline' | 'business-outline' | 'checkbox-outline' | 'document-text-outline' | 'chatbubble-ellipses-outline' | 'calendar-outline' | 'pulse-outline' | 'images-outline' | 'folder-open-outline' | 'reader-outline' | 'settings-outline';
  href: '/' | '/projects' | '/tasks' | '/field-notes' | '/ask' | '/schedule' | '/evidence' | '/photos' | '/documents' | '/reports' | '/settings';
};

export const desktopNavigationItems: readonly DesktopNavigationItem[] = Object.freeze([
  { page: 'overview', label: 'Overview', icon: 'home-outline', href: '/' },
  { page: 'projects', label: 'Projects', icon: 'business-outline', href: '/projects' },
  { page: 'tasks', label: 'Tasks', icon: 'checkbox-outline', href: '/tasks' },
  { page: 'field-notes', label: 'Field Notes', icon: 'document-text-outline', href: '/field-notes' },
  { page: 'ask-ecos', label: 'Ask ECOS', icon: 'chatbubble-ellipses-outline', href: '/ask' },
  { page: 'schedule', label: 'Schedule', icon: 'calendar-outline', href: '/schedule' },
  { page: 'evidence', label: 'Field Activity', icon: 'pulse-outline', href: '/evidence' },
  { page: 'photos', label: 'Photos', icon: 'images-outline', href: '/photos' },
  { page: 'documents', label: 'Documents', icon: 'folder-open-outline', href: '/documents' },
  { page: 'reports', label: 'Reports', icon: 'reader-outline', href: '/reports' },
  { page: 'settings', label: 'Settings', icon: 'settings-outline', href: '/settings' },
]);

export function desktopNavigationItemsForAudience(
  audience: VitruviusBetaAudience,
  askEcosPilotControl: VitruviusAskEcosPilotControl | null = null,
): readonly DesktopNavigationItem[] {
  if (vitruviusAudienceCanAccessAskEcos(audience, askEcosPilotControl)) {
    return desktopNavigationItems;
  }
  return Object.freeze(desktopNavigationItems.filter(item => item.page !== 'ask-ecos'));
}

export function desktopRouteIsActive(pathname: string, href: DesktopNavigationItem['href']) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Stateful desktop editors are intentionally scoped to both their page and
 * selected project. Changing either remounts the workspace so a draft that
 * began in one project can never be submitted into another project.
 */
export function desktopWorkspaceScopeKey(
  page: DesktopReadOnlyPage,
  selectedProject: string | null,
): string {
  const projectKey = selectedProject?.trim().toLowerCase().replace(/\s+/g, ' ') || 'all-projects';
  return `${page}:${projectKey}`;
}

export function desktopWorkspaceLayout(width: number): Readonly<{
  usesSidebar: boolean;
  compactContent: boolean;
}> {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  return Object.freeze({
    usesSidebar: safeWidth >= 900,
    compactContent: safeWidth < 520,
  });
}
