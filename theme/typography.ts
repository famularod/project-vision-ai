import type { TextStyle } from 'react-native';
import { colors } from './colors';

/** Instrument Serif: page titles, key numbers and the wordmark only (Atelier). */
export const displayFontFamily = 'InstrumentSerif-Regular';

export const typography: Record<
  'display' | 'h1' | 'h2' | 'h3' | 'body' | 'caption' | 'metric' | 'label',
  TextStyle
> = {
  display: {
    color: colors.text,
    fontSize: 37,
    fontFamily: displayFontFamily,
    lineHeight: 44,
    fontWeight: '400',
  },
  h1: {
    color: colors.text,
    fontSize: 32,
    fontFamily: displayFontFamily,
    lineHeight: 39,
    fontWeight: '400',
  },
  h2: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  h3: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
  },
  body: {
    color: colors.mutedText,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '500',
  },
  caption: {
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
  },
  metric: {
    color: colors.text,
    fontSize: 28,
    fontFamily: displayFontFamily,
    lineHeight: 35,
    fontWeight: '400',
  },
  label: {
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
};
