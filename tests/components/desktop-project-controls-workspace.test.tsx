import { render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children }: { children: React.ReactNode }) => (
      React.createElement(View, null, children)
    ),
  };
});
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/tasks',
  useRouter: () => ({ setParams: jest.fn() }),
}));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name',
  formatVitruviusDesktopGreeting: () => 'Good morning, David',
  readVitruviusDesktopDisplayName: () => 'David',
  writeVitruviusDesktopDisplayName: (value: string) => value.trim(),
}));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({
  desktopFieldNoteDataSource: {
    list: jest.fn(async () => []),
    save: jest.fn(),
    update: jest.fn(),
  },
}));

const assignedTask: DAVEWebScheduleItem = {
  id: 'task-assigned',
  itemType: 'Task',
  scheduleProjectName: '2321 Compliance Project',
  projectName: '2321 Compliance Project',
  projectTimeZone: 'America/Los_Angeles',
  locationName: 'North Lot',
  taskName: 'Place asphalt',
  startDate: '2099-07-27',
  finishDate: '2099-07-30',
  milestone: '',
  owner: '',
  contractor: 'Paving Crew',
  durationDays: 4,
  percentComplete: 0,
  progressSource: 'project_manager',
  progressConfirmedAt: '2026-07-26T12:00:00.000Z',
  progressConfirmedBy: 'David',
  priority: 'High',
  status: 'Not Started',
  notes: '',
  nextAction: '',
  activity: [],
  projectControls: {
    version: 1,
    assignee: 'pm@example.com',
    trade: 'Paving',
    watchers: [],
    approvers: ['Owner'],
    approvalStatus: 'Pending',
    workflowStage: 'In Review',
    referenceNumber: 'RFI-042',
    responseDueDate: '2099-07-29',
    checklist: [],
    linkedRecords: [],
    resources: [],
    estimatedCostImpact: 12_500,
    estimatedScheduleImpactDays: 4,
    impactConfidence: 'High',
    impactNotes: 'Pending owner direction',
    revision: 2,
    updatedAt: '2026-07-26T12:00:00.000Z',
    updatedBy: 'David',
  },
  createdAt: '2026-07-26T12:00:00.000Z',
  updatedAt: '2026-07-26T12:00:00.000Z',
  cloudUpdatedAt: '2026-07-26T12:00:01.000Z',
};

const completedShortTask: DAVEWebScheduleItem = {
  ...assignedTask,
  id: 'task-completed-short',
  taskName: 'Complete closeout item',
  durationDays: 1,
  percentComplete: 100,
  status: 'Complete',
};

const snapshot: DAVEWebReadOnlySnapshot = {
  projects: [{ id: 'project-1', name: '2321 Compliance Project' }],
  scheduleItems: [assignedTask, completedShortTask],
  projectUpdates: [],
  referenceDocuments: [],
  refreshedAt: '2026-07-26T12:00:01.000Z',
};

const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot,
  freshness: {
    status: 'connected',
    lastSuccessfulRefreshAt: snapshot.refreshedAt,
    lastAttemptAt: snapshot.refreshedAt,
    consecutiveFailures: 0,
  },
  message: null,
  signInWithPassword: jest.fn(),
  signOutOfDesktop: jest.fn(),
  refreshSnapshot: jest.fn(),
  getArtifactUrl: jest.fn(),
  createTask: jest.fn(),
  updateTask: jest.fn(),
  updateTasks: jest.fn(),
  deleteTask: jest.fn(),
  deleteDocument: jest.fn(),
  uploadDocument: jest.fn(),
  setCurrentSchedule: jest.fn(),
  saveReport: jest.fn(),
  restoreMissingTasks: jest.fn(),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

describe('desktop project controls workspace', () => {
  beforeAll(() => {
    type TestWindow = {
      addEventListener?: jest.Mock;
      removeEventListener?: jest.Mock;
    };
    const root = globalThis as unknown as { window?: unknown };
    const browserWindow = (root.window ?? {}) as TestWindow;
    root.window = browserWindow;
    browserWindow.addEventListener = jest.fn();
    browserWindow.removeEventListener = jest.fn();
  });

  it('surfaces personal work and portfolio impact in the task workspace', () => {
    const screen = render(<DesktopReadOnlyShell page="tasks" />);

    expect(screen.getAllByText('My Work').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Approval Needed')).toBeTruthy();
    expect(screen.queryByText('Cost Exposure')).toBeNull();
    expect(screen.queryByText('$12,500')).toBeNull();
    expect(screen.getByText('Task Delay Estimates')).toBeTruthy();
    expect(screen.getByText('4 days total')).toBeTruthy();
  });

  it('uses the same duration-weighted project progress as the mobile overview', () => {
    const screen = render(<DesktopReadOnlyShell page="projects" />);

    expect(screen.getByText('20% complete')).toBeTruthy();
    expect(screen.getByText('1 of 2 tasks')).toBeTruthy();
    expect(screen.queryByText('50% complete')).toBeNull();
  });

  it('provides a project-optional Field Notes inbox without creating a task', async () => {
    const screen = render(<DesktopReadOnlyShell page="field-notes" />);

    expect(screen.getByText('Field Notes review desk')).toBeTruthy();
    expect(screen.getByText('Field Notes inbox')).toBeTruthy();
    expect(screen.getByText('Review and edit')).toBeTruthy();
    expect(screen.queryByText('Capture a field note')).toBeNull();
    expect(screen.getByText(
      'Notes captured on iPhone and iPad arrive here for review and editing.',
    )).toBeTruthy();
    await waitFor(() => expect(screen.getByText('No open field notes.')).toBeTruthy());
  });
});
