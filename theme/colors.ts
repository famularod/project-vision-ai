export const colors = {
  primary: '#007AFF',
  secondary: '#5856D6',
  success: '#34C759',
  warning: '#FF9500',
  danger: '#FF3B30',
  background: '#F5F5F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F2F2F7',
  border: '#E5E5EA',
  text: '#1D1D1F',
  mutedText: '#6E6E73',
  tertiaryText: '#9A9AA0',
  primarySoft: '#EAF4FF',
  successSoft: '#EAF8EE',
  warningSoft: '#FFF4E5',
  dangerSoft: '#FFECEC',
} as const;

export type ThemeColor = keyof typeof colors;
