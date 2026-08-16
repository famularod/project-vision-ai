import { fireEvent, render } from '@testing-library/react-native';
import { AppBottomTabs } from '../../components/app-bottom-tabs';

// Ionicons loads its native font asynchronously on mount. This suite exercises
// tab behavior, so keep that external font lifecycle outside the test.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('AppBottomTabs', () => {
  it('routes the primary tabs and exposes the current selection', async () => {
    const onChange = jest.fn();
    const onTalk = jest.fn();
    const onAskECOS = jest.fn();
    const screen = await render(
      <AppBottomTabs current="Schedule" onChange={onChange} onTalk={onTalk} onAskECOS={onAskECOS} />,
    );

    expect(screen.getByRole('tab', { name: 'Tasks' }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByRole('tab', { name: 'Overview' }).props.accessibilityState).toEqual({ selected: false });

    await fireEvent.press(screen.getByRole('tab', { name: 'Reports' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Talk to project assistant' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Ask ECOS' }));

    expect(onChange).toHaveBeenCalledWith('Reports');
    expect(onTalk).toHaveBeenCalledTimes(1);
    expect(onAskECOS).toHaveBeenCalledTimes(1);
  });

  it('hides Ask ECOS for the fail-closed first outside pilot', async () => {
    const onAskECOS = jest.fn();
    const screen = await render(
      <AppBottomTabs
        current="Home"
        onChange={jest.fn()}
        onTalk={jest.fn()}
        onAskECOS={onAskECOS}
        audience="outside_pilot"
      />,
    );

    expect(screen.queryByRole('tab', { name: 'Ask ECOS' })).toBeNull();
    expect(onAskECOS).not.toHaveBeenCalled();
  });

  it('keeps Ask ECOS visibly selected for the full question experience', async () => {
    const screen = await render(
      <AppBottomTabs
        current="Home"
        onChange={jest.fn()}
        onTalk={jest.fn()}
        onAskECOS={jest.fn()}
        askEcosActive
      />,
    );

    expect(screen.getByRole('tab', { name: 'Ask ECOS' }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByRole('tab', { name: 'Overview' }).props.accessibilityState).toEqual({ selected: false });
  });
});
