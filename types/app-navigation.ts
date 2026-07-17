export type AppScreen =
  | 'Home'
  | 'SelectProject'
  | 'AddPhotos'
  | 'BuildUpdate'
  | 'ProjectWorkspace'
  | 'SavedUpdates'
  | 'UpdateDetail'
  | 'Reports'
  | 'Contacts'
  | 'Diagnostics'
  | 'ProjectDocuments'
  | 'Schedule'
  | 'Admin';

export const APP_SCREEN_PATHS = {
  Home: '/',
  SelectProject: '/projects/select',
  AddPhotos: '/capture/photos',
  BuildUpdate: '/capture/review',
  ProjectWorkspace: '/projects/workspace',
  SavedUpdates: '/updates',
  UpdateDetail: '/updates/detail',
  Reports: '/reports',
  Contacts: '/contacts',
  Diagnostics: '/settings/diagnostics',
  ProjectDocuments: '/projects/documents',
  Schedule: '/tasks',
  Admin: '/settings',
} as const satisfies Record<AppScreen, string>;

export function appPathForScreen(screen: AppScreen) {
  return APP_SCREEN_PATHS[screen];
}
