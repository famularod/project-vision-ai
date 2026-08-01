import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DailyBriefSection } from '../../components/DAVEProjectStatusViews';
import type { DAVEProjectDailyBriefAttentionItem } from '../../services/DAVEDailyBrief';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const LONG_ATTENTION_ITEM: DAVEProjectDailyBriefAttentionItem = {
  id: 'attention-1',
  evidenceClass: 'fact',
  category: 'schedule',
  text:
    'Place asphalt at the employee parking area is due this week and the current task record needs a confirmed finish date.',
  sourceType: 'schedule',
  sourceRecordId: 'task-1',
  timestamp: '2026-07-31T12:00:00.000Z',
  confidence: 'high',
  navigationTarget: 'schedule',
  limitations: [],
  priority: 1,
  whyItMatters:
    'Unconfirmed timing could affect access to the north lot and the next scheduled trade.',
  evidence: 'Current schedule and field update',
  actionText: 'Confirm the date with the project manager.',
};

describe('DailyBriefSection', () => {
  it('renders long operational copy in a full-width row and keeps it actionable', () => {
    const onOpen = jest.fn();
    const screen = render(
      <DailyBriefSection
        title="Daily Brief"
        items={[LONG_ATTENTION_ITEM]}
        emptyText="No current action is required."
        onOpen={onOpen}
      />,
    );

    const button = screen.getByRole('button', {
      name: `Daily Brief: ${LONG_ATTENTION_ITEM.text}`,
    });
    const flattenedStyle = StyleSheet.flatten(button.props.style);

    expect(flattenedStyle.width).toBe('100%');
    expect(flattenedStyle.minWidth).toBe(0);
    expect(screen.getByText(`• ${LONG_ATTENTION_ITEM.text}`)).toBeTruthy();
    expect(
      screen.getByText(
        `${LONG_ATTENTION_ITEM.whyItMatters} ${LONG_ATTENTION_ITEM.actionText}`,
      ),
    ).toBeTruthy();

    fireEvent.press(button);
    expect(onOpen).toHaveBeenCalledWith(LONG_ATTENTION_ITEM);
  });
});
