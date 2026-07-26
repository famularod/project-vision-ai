import { render } from '@testing-library/react-native';

import { DesktopOverviewPage } from '../../components/web-shell/desktop-overview-page';
import type { DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';
import type { CloudProjectUpdate } from '../../services/SupabaseService';
import type { ProjectUpdate, ScheduleItem } from '../../types';

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
}));

const overdueTask: ScheduleItem = {
  id: 'task-overdue',
  scheduleProjectName: 'Project Alpha',
  projectName: 'Project Alpha',
  locationName: 'Canopy A',
  taskName: 'Install panels',
  startDate: '01/01/2000',
  finishDate: '01/02/2000',
  milestone: '',
  owner: 'Project manager',
  contractor: 'Panel Crew',
  percentComplete: 25,
  priority: 'High',
  status: 'In Progress',
  notes: '',
  createdAt: '2000-01-01T12:00:00.000Z',
};

const completedTask: ScheduleItem = {
  ...overdueTask,
  id: 'task-complete',
  taskName: 'Place concrete',
  locationName: 'East Driveway',
  percentComplete: 100,
  status: 'Complete',
};

const openTask: ScheduleItem = {
  ...overdueTask,
  id: 'task-open',
  projectName: 'Project Beta',
  scheduleProjectName: 'Project Beta',
  taskName: 'Install handrails',
  locationName: '',
  finishDate: '12/31/2099',
  percentComplete: 0,
  priority: 'Medium',
  status: 'Not Started',
};

const updates: CloudProjectUpdate<ProjectUpdate>[] = [
  projectUpdate({
    id: 'update-note',
    projectName: 'Project Alpha',
    areaName: 'Canopy A',
    updatedAt: '2026-07-22T10:00:00.000Z',
    notes: 'Panel framing started.',
  }),
  projectUpdate({
    id: 'update-task',
    projectName: 'Project Beta',
    areaName: '',
    updatedAt: 'invalid-date',
    scheduleTaskName: 'Install handrails',
  }),
  projectUpdate({
    id: 'update-photo',
    projectName: 'Project Alpha',
    areaName: 'East Driveway',
    updatedAt: '2026-07-21T10:00:00.000Z',
    photo: true,
  }),
];

const documentRecord: DAVEWebReferenceDocument = {
  id: 'document-1',
  name: 'Current Schedule',
  originalFileName: 'schedule.pdf',
  uri: '',
  category: 'Schedules',
  notes: '',
  isCurrent: true,
  importedAt: '2026-07-21T12:00:00.000Z',
  cloudUpdatedAt: '2026-07-21T12:00:00.000Z',
  linkedScheduleItems: [],
};

describe('DesktopOverviewPage', () => {
  it('renders current portfolio facts, priority work, projects, and recent activity', () => {
    const screen = render(
      <DesktopOverviewPage
        documents={[documentRecord]}
        projects={[
          { id: 'project-alpha', name: 'Project Alpha' },
          { id: 'project-beta', name: 'Project Beta' },
        ]}
        selectedProject={null}
        tasks={[openTask, completedTask, overdueTask]}
        updates={updates}
      />,
    );

    expect(screen.getByText('Project Health')).toBeTruthy();
    expect(screen.getAllByText('3')).toHaveLength(2);
    expect(screen.getByText('Install panels')).toBeTruthy();
    expect(screen.getByText('Panel framing started.')).toBeTruthy();
    expect(screen.getByText('1 of 2 tasks complete')).toBeTruthy();
    expect(screen.getByText('0 of 1 tasks complete')).toBeTruthy();
  });
});

function projectUpdate({
  id,
  projectName,
  areaName,
  updatedAt,
  notes = '',
  scheduleTaskName = null,
  photo = false,
}: {
  id: string;
  projectName: string;
  areaName: string;
  updatedAt: string;
  notes?: string;
  scheduleTaskName?: string | null;
  photo?: boolean;
}): CloudProjectUpdate<ProjectUpdate> {
  return {
    id,
    projectName,
    areaName,
    updatedAt,
    updateData: {
      id,
      projectName,
      date: updatedAt,
      photos: photo
        ? [{ id: `${id}-photo`, uri: 'file://project-photo.jpg' } as ProjectUpdate['photos'][number]]
        : [],
      notes,
      recipients: { contactIds: [] },
      scheduleTaskName,
    },
  };
}
