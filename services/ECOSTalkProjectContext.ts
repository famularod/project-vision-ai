import type { AppScreen } from '../types/app-navigation';

export function talkContextProjectForScreen(
  screen: AppScreen,
  workspaceProject: string,
  reportProject: string | null,
): string | null {
  if (screen === 'Reports') return reportProject;
  if (
    screen === 'ProjectWorkspace' ||
    screen === 'ProjectDocuments' ||
    screen === 'UpdateDetail' ||
    screen === 'AddPhotos' ||
    screen === 'BuildUpdate'
  ) return workspaceProject;
  return null;
}
