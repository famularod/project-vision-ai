import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  VITRUVIUS_BRAND_DARK_BLUE,
  VITRUVIUS_BRAND_SOFT_BLUE,
  VitruviusBrandLockup,
} from '../../components/vitruvius-brand-lockup';

describe('VitruviusBrandLockup', () => {
  it('uses the approved shared brand on native surfaces', () => {
    const screen = render(
      <VitruviusBrandLockup testID="brand-lockup" />,
    );

    expect(screen.getByText('Vitruvius')).toBeTruthy();
    expect(screen.getByText('Project Intelligence')).toBeTruthy();

    const monogram = screen.getByText('V');
    expect(StyleSheet.flatten(monogram.props.style).color).toBe(
      VITRUVIUS_BRAND_DARK_BLUE,
    );
    expect(
      StyleSheet.flatten(
        screen.getByTestId('brand-lockup-mark').props.style,
      ).backgroundColor,
    ).toBe(VITRUVIUS_BRAND_SOFT_BLUE);
  });

  it('can render the mark alone in a compact rail', () => {
    const screen = render(
      <VitruviusBrandLockup compact showText={false} />,
    );

    expect(screen.getByText('V')).toBeTruthy();
    expect(screen.queryByText('Vitruvius')).toBeNull();
  });
});
