import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text } from 'react-native';

import { AppShellFrame } from '../../components/app-shell-frame';

// Ionicons loads its native font asynchronously on mount. This suite exercises
// shell navigation, so keep that external font lifecycle outside the test.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('AppShellFrame', () => {
  beforeEach(() => {
    setWindowDimensions({
      width: 390,
      height: 844,
      scale: 3,
      fontScale: 1,
    });
  });

  afterEach(() => {
    setWindowDimensions({
      width: 390,
      height: 844,
      scale: 3,
      fontScale: 1,
    });
  });

  it('preserves bottom navigation and behavior at compact phone width', async () => {
    const onScreenChange = jest.fn();
    const screen = await render(
      <AppShellFrame
        currentScreen="Home"
        onScreenChange={onScreenChange}
        onTalk={jest.fn()}
      >
        <Text>Current project overview</Text>
      </AppShellFrame>,
    );

    expect(screen.getByText('Current project overview')).toBeTruthy();
    expect(screen.getByTestId('app-bottom-tabs')).toBeTruthy();
    expect(screen.queryByTestId('app-navigation-rail')).toBeNull();

    await fireEvent.press(screen.getByRole('tab', { name: 'Tasks' }));
    expect(onScreenChange).toHaveBeenCalledWith('Schedule');
  });

  it('uses a compact navigation rail at medium iPad width', async () => {
    setWindowDimensions({
      width: 768,
      height: 1024,
      scale: 2,
      fontScale: 1,
    });
    const screen = await render(
      <AppShellFrame
        currentScreen="Home"
        onScreenChange={jest.fn()}
        onTalk={jest.fn()}
      >
        <Text>Portrait iPad workspace</Text>
      </AppShellFrame>,
    );

    expect(screen.getByText('Portrait iPad workspace')).toBeTruthy();
    expect(screen.getByTestId('app-navigation-rail')).toBeTruthy();
    expect(screen.queryByText('Project Vision AI')).toBeNull();
    expect(screen.queryByTestId('app-bottom-tabs')).toBeNull();
  });

  it('returns to the phone shell in a narrow iPad Split View window', async () => {
    setWindowDimensions({
      width: 520,
      height: 1024,
      scale: 2,
      fontScale: 1,
    });
    const screen = await render(
      <AppShellFrame
        currentScreen="Reports"
        onScreenChange={jest.fn()}
        onTalk={jest.fn()}
      >
        <Text>Narrow Split View report</Text>
      </AppShellFrame>,
    );

    expect(screen.getByText('Narrow Split View report')).toBeTruthy();
    expect(screen.getByTestId('app-bottom-tabs')).toBeTruthy();
    expect(screen.queryByTestId('app-navigation-rail')).toBeNull();
    expect(
      screen.getByRole('tab', { name: 'Reports' }).props.accessibilityState,
    ).toEqual({ selected: true });
  });

  it('keeps the medium iPad navigation usable with large text enabled', async () => {
    setWindowDimensions({
      width: 768,
      height: 1024,
      scale: 2,
      fontScale: 2,
    });
    const screen = await render(
      <AppShellFrame
        currentScreen="ProjectDocuments"
        onScreenChange={jest.fn()}
        onTalk={jest.fn()}
      >
        <Text>Large text document workspace</Text>
      </AppShellFrame>,
    );

    expect(screen.getByText('Large text document workspace')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Documents' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Talk to project assistant' })).toBeTruthy();
    expect(screen.queryByTestId('app-bottom-tabs')).toBeNull();
  });

  it('uses an expanded navigation rail at wide iPad width', async () => {
    setWindowDimensions({
      width: 1024,
      height: 768,
      scale: 2,
      fontScale: 1,
    });
    const onScreenChange = jest.fn();
    const onTalk = jest.fn();
    const screen = await render(
      <AppShellFrame
        currentScreen="Schedule"
        onScreenChange={onScreenChange}
        onTalk={onTalk}
      >
        <Text>Wide project workspace</Text>
      </AppShellFrame>,
    );

    expect(screen.getByText('Wide project workspace')).toBeTruthy();
    expect(screen.getByTestId('app-navigation-rail')).toBeTruthy();
    expect(screen.getByText('Project Vision AI')).toBeTruthy();
    expect(screen.queryByTestId('app-bottom-tabs')).toBeNull();
    expect(
      screen.getByRole('tab', { name: 'Tasks' }).props.accessibilityState,
    ).toEqual({ selected: true });
    expect(StyleSheet.flatten(
      screen.getByRole('button', { name: 'Talk to project assistant' }).props.style,
    ).backgroundColor).toBe('transparent');

    await fireEvent.press(screen.getByRole('tab', { name: 'Reports' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Talk to project assistant' }),
    );

    expect(onScreenChange).toHaveBeenCalledWith('Reports');
    expect(onTalk).toHaveBeenCalledTimes(1);
  });

  it('preserves child state when the window crosses a shell breakpoint', async () => {
    const screen = await render(
      <AppShellFrame
        currentScreen="Home"
        onScreenChange={jest.fn()}
        onTalk={jest.fn()}
      >
        <StatefulDraftProbe />
      </AppShellFrame>,
    );

    await fireEvent.press(
      screen.getByRole('button', { name: 'Add draft item' }),
    );
    expect(screen.getByText('Draft items: 1')).toBeTruthy();

    setWindowDimensions({
      width: 1024,
      height: 768,
      scale: 2,
      fontScale: 1,
    });

    expect(screen.getByTestId('app-navigation-rail')).toBeTruthy();
    expect(screen.getByText('Draft items: 1')).toBeTruthy();
  });

  it('preserves the selected task project while a wide iPad resizes', async () => {
    setWindowDimensions({
      width: 1180,
      height: 820,
      scale: 2,
      fontScale: 1,
    });
    const screen = await render(<TaskProjectShellProbe />);

    await fireEvent.press(
      screen.getByRole('radio', { name: 'Show tasks for Project B' }),
    );
    expect(
      screen.getByRole('radio', { name: 'Show tasks for Project B' }).props
        .accessibilityState,
    ).toEqual({ selected: true });

    setWindowDimensions({
      width: 768,
      height: 1024,
      scale: 2,
      fontScale: 1,
    });
    expect(screen.queryByTestId('task-project-switcher')).toBeNull();

    setWindowDimensions({
      width: 1180,
      height: 820,
      scale: 2,
      fontScale: 1,
    });
    expect(
      screen.getByRole('radio', { name: 'Show tasks for Project B' }).props
        .accessibilityState,
    ).toEqual({ selected: true });
  });

  it('preserves the selected update project while a wide iPad resizes', async () => {
    setWindowDimensions({ width: 1180, height: 820, scale: 2, fontScale: 1 });
    const screen = await render(<UpdateProjectShellProbe />);

    await fireEvent.press(
      screen.getByRole('radio', { name: 'Show updates for Project B' }),
    );
    expect(
      screen.getByRole('radio', { name: 'Show updates for Project B' }).props
        .accessibilityState,
    ).toEqual({ selected: true });

    setWindowDimensions({ width: 768, height: 1024, scale: 2, fontScale: 1 });
    expect(screen.queryByTestId('update-project-switcher')).toBeNull();

    setWindowDimensions({ width: 1180, height: 820, scale: 2, fontScale: 1 });
    expect(
      screen.getByRole('radio', { name: 'Show updates for Project B' }).props
      .accessibilityState,
    ).toEqual({ selected: true });
  });

  it('keeps project documents directly accessible and preserves their project on resize', async () => {
    setWindowDimensions({ width: 1180, height: 820, scale: 2, fontScale: 1 });
    const screen = await render(<DocumentProjectShellProbe />);

    expect(
      screen.getByRole('tab', { name: 'Documents' }).props.accessibilityState,
    ).toEqual({ selected: true });
    expect(
      screen.getByRole('tab', { name: 'Overview' }).props.accessibilityState,
    ).toEqual({ selected: false });
    expect(screen.queryByRole('radio', { name: 'Show documents for all projects' }))
      .toBeNull();

    await fireEvent.press(
      screen.getByRole('radio', { name: 'Show documents for Project B' }),
    );

    setWindowDimensions({ width: 768, height: 1024, scale: 2, fontScale: 1 });
    expect(screen.queryByTestId('document-project-switcher')).toBeNull();

    setWindowDimensions({ width: 1180, height: 820, scale: 2, fontScale: 1 });
    expect(
      screen.getByRole('radio', { name: 'Show documents for Project B' }).props
        .accessibilityState,
    ).toEqual({ selected: true });
  });
});

function StatefulDraftProbe() {
  const [draftItems, setDraftItems] = useState(0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add draft item"
      onPress={() => setDraftItems(current => current + 1)}
    >
      <Text>{`Draft items: ${draftItems}`}</Text>
    </Pressable>
  );
}

function TaskProjectShellProbe() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  return (
    <AppShellFrame
      currentScreen="Schedule"
      onScreenChange={jest.fn()}
      onTalk={jest.fn()}
      taskProjects={['Project A', 'Project B']}
      selectedTaskProject={selectedProject}
      onTaskProjectChange={setSelectedProject}
    >
      <Text>Task workspace</Text>
    </AppShellFrame>
  );
}

function UpdateProjectShellProbe() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  return (
    <AppShellFrame
      currentScreen="SavedUpdates"
      onScreenChange={jest.fn()}
      onTalk={jest.fn()}
      updateProjects={['Project A', 'Project B']}
      selectedUpdateProject={selectedProject}
      onUpdateProjectChange={setSelectedProject}
    >
      <Text>Update workspace</Text>
    </AppShellFrame>
  );
}

function DocumentProjectShellProbe() {
  const [selectedProject, setSelectedProject] = useState<string | null>('Project A');

  return (
    <AppShellFrame
      currentScreen="ProjectDocuments"
      onScreenChange={jest.fn()}
      onTalk={jest.fn()}
      documentProjects={['Project A', 'Project B']}
      selectedDocumentProject={selectedProject}
      onDocumentProjectChange={setSelectedProject}
    >
      <Text>Document workspace</Text>
    </AppShellFrame>
  );
}

function setWindowDimensions(window: {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
}) {
  act(() => {
    Dimensions.set({ window, screen: window });
  });
}
