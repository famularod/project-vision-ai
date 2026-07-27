import { render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
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

const snapshot: DAVEWebReadOnlySnapshot = {
  projects: [{ id: 'project-1', name: '2321 Compliance Project' }],
  scheduleItems: [assignedTask],
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
    expect(screen.getByText('Cost Exposure')).toBeTruthy();
    expect(screen.getByText('$12,500')).toBeTruthy();
    expect(screen.getByText('Task Delay Estimates')).toBeTruthy();
    expect(screen.getByText('4 days total')).toBeTruthy();
  });
});
