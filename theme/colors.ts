export const colors = {
  primary: '#1F3A2E',
  secondary: '#4F3F99',
  success: '#1F5E3F',
  warning: '#8A5A00',
  danger: '#9E2A22',
  background: '#FBFAF8',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F1EC',
  border: '#E7E4DE',
  text: '#1A1A18',
  mutedText: '#66645E',
  tertiaryText: '#8A877F',
  primarySoft: '#E3EAE5',
  successSoft: '#E6EFE9',
  warningSoft: '#FBF3E2',
  dangerSoft: '#F8ECEA',
} as const;

export type ThemeColor = keyof typeof colors;
