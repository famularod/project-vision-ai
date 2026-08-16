import { accountDisplayNameForMetadata } from '../../services/AccountProfile';

describe('account display name', () => {
  it('prefers the Project Vision account name across devices', () => {
    expect(accountDisplayNameForMetadata({
      project_vision_display_name: ' David ',
      full_name: 'Different Device Name',
    })).toBe('David');
  });

  it('falls back to standard identity metadata', () => {
    expect(accountDisplayNameForMetadata({ full_name: 'David Famularo' }))
      .toBe('David Famularo');
    expect(accountDisplayNameForMetadata({ name: 'David' })).toBe('David');
    expect(accountDisplayNameForMetadata(null)).toBe('');
  });
});
