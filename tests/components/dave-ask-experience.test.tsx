import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DAVEAskExperience } from '../../components/DAVEAskExperience';
import type { DAVEProjectIntelligence } from '../../services/DAVEIntelligence';

const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockSetItem = jest.fn<Promise<void>, [string, string]>(() => Promise.resolve());

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => mockGetItem(key),
    setItem: (key: string, value: string) => mockSetItem(key, value),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

describe('DAVE Ask history hydration', () => {
  const intelligence = { projectId: 'project-a' } as DAVEProjectIntelligence;

  beforeEach(() => {
    mockGetItem.mockReset();
    mockSetItem.mockClear();
  });

  it('fails closed after a read error and retries without overwriting history', async () => {
    mockGetItem
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(null);

    render(
      <DAVEAskExperience
        intelligence={intelligence}
        onOpenSupportingRecord={jest.fn()}
      />,
    );

    expect(await screen.findByText('Saved questions could not be opened.')).toBeTruthy();
    const suggestedQuestion = screen.getByRole('button', {
      name: 'Ask project assistant: What changed today?',
    });
    expect(suggestedQuestion.props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(suggestedQuestion);
    expect(mockSetItem).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Retry loading saved questions' }));
    await waitFor(() => expect(mockGetItem).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Ask me about this project.')).toBeTruthy();
  });

  it('fails closed on corrupt stored history instead of replacing it with an empty list', async () => {
    mockGetItem.mockResolvedValue('{not-json');

    render(
      <DAVEAskExperience
        intelligence={intelligence}
        onOpenSupportingRecord={jest.fn()}
      />,
    );

    expect(await screen.findByText('Saved questions could not be opened.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', {
      name: 'Ask project assistant: What changed today?',
    }));
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});
