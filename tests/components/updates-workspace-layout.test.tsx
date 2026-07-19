import { fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import {
  UpdatesWideWorkspace,
  type UpdatePhotoComparisonViewModel,
} from '../../components/updates-workspace-layout';

const comparison: UpdatePhotoComparisonViewModel = {
  priorUri: 'file:///prior.jpg',
  priorLabel: 'July 10 · Canopy A',
  currentUri: 'file:///current.jpg',
  currentLabel: 'July 19 · Canopy A',
  summary: 'Panels now cover the east elevation.',
  confidence: 'High confidence',
  comparability: 'Comparable',
};

describe('UpdatesWideWorkspace', () => {
  it('provides controlled update selection and source-backed photo comparison', async () => {
    const screen = await render(<WorkspaceProbe />);

    expect(screen.getByTestId('updates-wide-workspace')).toBeTruthy();
    expect(screen.getByTestId('update-photo-comparison')).toBeTruthy();
    expect(screen.getByText('Inspecting update-a')).toBeTruthy();
    expect(screen.getByText('Panels now cover the east elevation.')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Open update update-b' }));

    expect(screen.getByText('Inspecting update-b')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Open update update-b' }).props
        .accessibilityState,
    ).toEqual({ selected: true });
  });
});

function WorkspaceProbe() {
  const [selectedUpdateId, setSelectedUpdateId] = useState('update-a');
  const items = [{ id: 'update-a' }, { id: 'update-b' }];

  return (
    <UpdatesWideWorkspace
      items={items}
      selectedUpdateId={selectedUpdateId}
      onSelectUpdate={setSelectedUpdateId}
      renderMasterItem={({ item, selected, onSelect }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open update ${item.id}`}
          accessibilityState={{ selected }}
          onPress={onSelect}
        >
          <Text>{item.id}</Text>
        </Pressable>
      )}
      masterHeader={<Text>Update controls</Text>}
      inspector={<Text>{`Inspecting ${selectedUpdateId}`}</Text>}
      comparison={comparison}
      emptyState={<Text>No updates</Text>}
    />
  );
}
