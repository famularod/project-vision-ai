import type { TextStyle } from 'react-native';
import { colors } from './colors';

export const typography: Record<
  'display' | 'h1' | 'h2' | 'h3' | 'body' | 'caption' | 'metric' | 'label',
  TextStyle
> = {
  display: {
    color: colors.text,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
  },
  h1: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  h2: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
  },
  h3: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  body: {
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  caption: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  metric: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  label: {
    color: colors.mutedText,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
};
