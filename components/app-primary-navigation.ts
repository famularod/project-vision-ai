import type { AppScreen } from '../types/app-navigation';

export function isOverviewPrimaryNavigationActive(screen: AppScreen) {
  return (
    screen === 'Home' ||
    screen === 'ProjectWorkspace' ||
    screen === 'ProjectDocuments' ||
    screen === 'SavedUpdates' ||
    screen === 'UpdateDetail' ||
    screen === 'Admin'
  );
}
