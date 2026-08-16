import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { buildDAVEWebReportSource } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

let mockSearchParams: Record<string, string> = {};
let mockPathname = '/tasks';

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
  useLocalSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
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
  projectId: 'project-1',
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

let mockSnapshot: DAVEWebReadOnlySnapshot = snapshot;

const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  get snapshot() {
    return mockSnapshot;
  },
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
  refreshSnapshotForAuthorization: jest.fn(async () => mockSnapshot),
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

  beforeEach(() => {
    mockPathname = '/tasks';
    mockSearchParams = {};
    mockSnapshot = snapshot;
    jest.clearAllMocks();
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

  it('fails closed on portfolio report preparation without an immutable project selection', () => {
    mockPathname = '/reports';

    const screen = render(<DesktopReadOnlyShell page="reports" />);

    expect(screen.getByText('Choose one exact project before preparing or saving a report.')).toBeTruthy();
    expect(screen.queryByText('Review & Prepare Report')).toBeNull();
    expect(mockAuth.saveReport).not.toHaveBeenCalled();
  });

  it('does not recover a malformed supplied project id through a unique display name', () => {
    mockPathname = '/reports';
    mockSearchParams = {
      project: '2321 Compliance Project',
      projectId: ' project-1 ',
    };

    const screen = render(<DesktopReadOnlyShell page="reports" />);

    expect(screen.getByText('Choose one exact project before preparing or saving a report.')).toBeTruthy();
    expect(screen.queryByText('Review & Prepare Report')).toBeNull();
    expect(mockAuth.saveReport).not.toHaveBeenCalled();
  });

  it('isolates same-name tasks, updates, and photos by the selected immutable project id', () => {
    const taskForProject = (id: string, projectId: string, label: string) => ({
      ...assignedTask,
      id,
      projectId,
      scheduleProjectName: 'Shared Project',
      projectName: 'Shared Project',
      taskName: label,
    });
    const updateForProject = (id: string, projectId: string, label: string) => ({
      id,
      projectName: 'Shared Project',
      areaName: 'North Lot',
      idempotencyKey: id,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      ownerId: 'owner-1',
      updateData: {
        id,
        projectId,
        projectName: 'Shared Project',
        date: '2026-08-10T00:00:00.000Z',
        notes: `${label} update evidence`,
        recipients: { contactIds: [] },
        photos: [{
          id: `photo-${id}`,
          uri: '',
          caption: `${label} photo evidence`,
          category: 'Update',
          actionRequired: '',
          actionOwner: '',
          actionDueDate: '',
          actionStatus: 'Open',
        }],
      },
    });
    mockSearchParams = { project: 'Shared Project', projectId: 'project-a' };
    mockSnapshot = {
      projects: [
        { id: 'project-a', name: 'Shared Project' },
        { id: 'project-b', name: 'Shared Project' },
      ],
      scheduleItems: [
        taskForProject('task-a', 'project-a', 'A-only task'),
        taskForProject('task-b', 'project-b', 'B-only task'),
      ],
      projectUpdates: [
        updateForProject('update-a', 'project-a', 'A-only'),
        updateForProject('update-b', 'project-b', 'B-only'),
      ],
      referenceDocuments: [],
      refreshedAt: '2026-08-10T00:00:01.000Z',
    } as DAVEWebReadOnlySnapshot;

    mockPathname = '/tasks';
    const taskScreen = render(<DesktopReadOnlyShell page="tasks" />);
    fireEvent.press(taskScreen.getByLabelText('Expand North Lot'));
    expect(taskScreen.getAllByText('A-only task').length).toBeGreaterThan(0);
    expect(taskScreen.queryByText('B-only task')).toBeNull();
    taskScreen.unmount();

    mockPathname = '/evidence';
    const evidenceScreen = render(<DesktopReadOnlyShell page="evidence" />);
    expect(evidenceScreen.getByText('A-only update evidence')).toBeTruthy();
    expect(evidenceScreen.queryByText('B-only update evidence')).toBeNull();
    evidenceScreen.unmount();

    mockPathname = '/photos';
    const photoScreen = render(<DesktopReadOnlyShell page="photos" />);
    expect(photoScreen.getByText('A-only photo evidence')).toBeTruthy();
    expect(photoScreen.queryByText('B-only photo evidence')).toBeNull();
  });

  it('carries same-name project B through report facts, source ids, and save input', async () => {
    mockPathname = '/reports';
    mockSearchParams = { project: 'Shared Project', projectId: 'project-b' };
    mockSnapshot = {
      projects: [
        { id: 'project-a', name: 'Shared Project' },
        { id: 'project-b', name: 'Shared Project' },
      ],
      scheduleItems: [
        {
          ...assignedTask,
          id: 'task-a',
          projectId: 'project-a',
          scheduleProjectName: 'Shared Project',
          projectName: 'Shared Project',
          taskName: 'A only task',
        },
        {
          ...assignedTask,
          id: 'task-b',
          projectId: 'project-b',
          scheduleProjectName: 'Shared Project',
          projectName: 'Shared Project',
          taskName: 'B only task',
        },
      ],
      projectUpdates: [],
      referenceDocuments: [],
      refreshedAt: '2026-08-09T20:00:00.000Z',
    };
    mockAuth.saveReport.mockResolvedValueOnce('2026-08-09T20:01:00.000Z');

    const screen = render(<DesktopReadOnlyShell page="reports" />);

    expect(screen.getAllByText(/B only task/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/A only task/)).toBeNull();
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Save Draft'));

    await waitFor(() => expect(mockAuth.saveReport).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-b',
      projectName: 'Shared Project',
      report: expect.objectContaining({
        sourceScopeKey: 'project-id:project-b',
        sourceTaskIds: ['task-b'],
      }),
    })));
  });

  it('blocks share, clipboard, and email after an approved report source becomes stale', async () => {
    mockPathname = '/reports';
    mockSearchParams = {
      project: '2321 Compliance Project',
      projectId: 'project-1',
    };
    const sourceSnapshot = {
      ...snapshot,
      scheduleItems: [{ ...assignedTask, taskName: 'Approved source task' }],
    } as DAVEWebReadOnlySnapshot;
    const source = buildDAVEWebReportSource(sourceSnapshot, {
      projectId: 'project-1',
      projectName: '2321 Compliance Project',
    });
    mockSnapshot = {
      ...sourceSnapshot,
      referenceDocuments: [{
        id: 'approved-report-1',
        name: 'Approved report',
        originalFileName: 'approved-report.md',
        uri: '',
        mimeType: 'text/markdown',
        category: 'Report',
        notes: 'Approved project report',
        isCurrent: true,
        importedAt: source.refreshedAt,
        projectId: 'project-1',
        projectName: '2321 Compliance Project',
        projectNames: ['2321 Compliance Project'],
        importBatchId: null,
        cloudUpdatedAt: '2026-08-10T00:00:01.000Z',
        linkedScheduleItems: [],
        webReport: {
          status: 'approved',
          title: 'Approved report',
          body: 'Approved source task is complete.',
          generatedAt: source.refreshedAt,
          sourceRefreshedAt: source.refreshedAt,
          sourceFingerprint: source.fingerprint,
          sourceScopeKey: source.scopeKey,
          sourceTaskIds: source.taskIds,
          sourceUpdateIds: source.updateIds,
          sourceDocumentIds: source.documentIds,
          sourceMedia: source.media,
          audit: [],
        },
      }],
    } as DAVEWebReadOnlySnapshot;
    const share = jest.fn(async () => undefined);
    const writeText = jest.fn(async () => undefined);
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { share, clipboard: { writeText } },
    });
    const open = jest.fn();
    Object.assign(globalThis.window as object, { open });

    const screen = render(<DesktopReadOnlyShell page="reports" />);
    fireEvent.press(screen.getByText('Open'));
    expect(screen.getByText('Share Approved Report')).toBeTruthy();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByText('Prepare Email'));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText } },
    });
    fireEvent.press(screen.getByText('Share Approved Report'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { share, clipboard: { writeText } },
    });
    share.mockClear();
    writeText.mockClear();
    open.mockClear();

    const delayedCloudChange = {
      ...mockSnapshot,
      scheduleItems: [{
        ...assignedTask,
        taskName: 'Approved source task changed on another device',
        updatedAt: '2026-08-10T00:00:30.000Z',
      }],
      refreshedAt: '2026-08-10T00:00:30.000Z',
    } as DAVEWebReadOnlySnapshot;
    mockAuth.refreshSnapshotForAuthorization.mockResolvedValueOnce(delayedCloudChange);
    fireEvent.press(screen.getByText('Share Approved Report'));
    await waitFor(() => expect(screen.getByText(
      /approved report revision changed in the cloud/i,
    )).toBeTruthy());
    expect(share).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();

    mockAuth.refreshSnapshotForAuthorization.mockResolvedValueOnce(delayedCloudChange);
    fireEvent.press(screen.getByText('Prepare Email'));
    await waitFor(() => expect(open).not.toHaveBeenCalled());

    mockSnapshot = {
      ...mockSnapshot,
      scheduleItems: [{
        ...assignedTask,
        taskName: 'Approved source task changed',
        updatedAt: '2026-08-10T00:01:00.000Z',
      }],
      refreshedAt: '2026-08-10T00:01:00.000Z',
    };
    screen.rerender(<DesktopReadOnlyShell page="reports" />);

    expect(screen.getAllByText('Refresh required').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('Share Approved Report'));
    fireEvent.press(screen.getByText('Prepare Email'));
    const invokeDisabledHandler = async (label: string) => {
      let node: any = screen.getByText(label);
      while (node && typeof node.props?.onPress !== 'function') node = node.parent;
      expect(typeof node?.props?.onPress).toBe('function');
      await act(async () => {
        await node.props.onPress();
      });
    };
    await invokeDisabledHandler('Share Approved Report');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText } },
    });
    await invokeDisabledHandler('Share Approved Report');
    await invokeDisabledHandler('Prepare Email');
    expect(share).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('blocks persisted project B report provenance that points at same-name project A media', () => {
    mockPathname = '/reports';
    mockSearchParams = { project: 'Shared Project', projectId: 'project-b' };
    const taskForProject = (id: string, projectId: string, taskName: string) => ({
      ...assignedTask,
      id,
      projectId,
      scheduleProjectName: 'Shared Project',
      projectName: 'Shared Project',
      taskName,
    });
    const updateForProject = (id: string, projectId: string, label: string) => ({
      id,
      projectName: 'Shared Project',
      areaName: 'North Lot',
      idempotencyKey: id,
      createdAt: '2026-08-09T20:00:00.000Z',
      updatedAt: '2026-08-09T20:00:00.000Z',
      ownerId: 'owner-1',
      updateData: {
        id,
        projectId,
        projectName: 'Shared Project',
        date: '2026-08-09T20:00:00.000Z',
        notes: label,
        recipients: { contactIds: [] },
        photos: [{
          id: `photo-${id}`,
          uri: '',
          cloudStoragePath: `shared/${id}.jpg`,
          caption: label,
          category: 'Update',
          actionRequired: '',
          actionOwner: '',
          actionDueDate: '',
          actionStatus: 'Open',
        }],
      },
    });
    const drawingForProject = (id: string, projectId: string, name: string) => ({
      id,
      name,
      originalFileName: `${name}.pdf`,
      uri: '',
      mimeType: 'application/pdf',
      category: 'Drawing',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-09T20:00:00.000Z',
      projectId,
      projectName: 'Shared Project',
      projectNames: ['Shared Project'],
      importBatchId: null,
      cloudUpdatedAt: '2026-08-09T20:00:00.000Z',
      linkedScheduleItems: [],
    });
    const exactSnapshot = {
      projects: [
        { id: 'project-a', name: 'Shared Project' },
        { id: 'project-b', name: 'Shared Project' },
      ],
      scheduleItems: [
        taskForProject('task-a', 'project-a', 'A only task'),
        taskForProject('task-b', 'project-b', 'B only task'),
      ],
      projectUpdates: [
        updateForProject('update-a', 'project-a', 'A only update'),
        updateForProject('update-b', 'project-b', 'B only update'),
      ],
      referenceDocuments: [
        drawingForProject('drawing-a', 'project-a', 'A only drawing'),
        drawingForProject('drawing-b', 'project-b', 'B only drawing'),
      ],
      refreshedAt: '2026-08-09T20:05:00.000Z',
    } as DAVEWebReadOnlySnapshot;
    const currentSource = buildDAVEWebReportSource(exactSnapshot, {
      projectId: 'project-b',
      projectName: 'Shared Project',
    });
    mockSnapshot = {
      ...exactSnapshot,
      referenceDocuments: [
        ...exactSnapshot.referenceDocuments,
        {
          ...drawingForProject('report-b', 'project-b', 'Saved B report'),
          originalFileName: 'saved-b-report.md',
          mimeType: 'text/markdown',
          category: 'Report',
          webReport: {
            status: 'approved',
            title: 'Saved B report',
            body: 'Owner-edited report body.',
            generatedAt: '2026-08-09T20:05:00.000Z',
            sourceRefreshedAt: currentSource.refreshedAt,
            sourceFingerprint: currentSource.fingerprint,
            sourceScopeKey: currentSource.scopeKey,
            sourceTaskIds: ['task-a'],
            sourceUpdateIds: ['update-a'],
            sourceDocumentIds: ['drawing-a'],
            audit: [],
          },
        },
      ],
    } as DAVEWebReadOnlySnapshot;

    const screen = render(<DesktopReadOnlyShell page="reports" />);

    expect(screen.getByText(/Saved source proof does not match the current exact project record/)).toBeTruthy();
    fireEvent.press(screen.getByText('Open'));
    fireEvent.press(screen.getByText('Download Word Report'));
    expect(screen.getAllByText('Download Word Report')).toHaveLength(1);
    expect(mockAuth.getArtifactUrl).not.toHaveBeenCalled();
  });
});
