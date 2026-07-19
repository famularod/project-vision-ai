import { countLabel, pluralWord } from '../../utils/pluralization';

describe('pluralization', () => {
  it('keeps the singular form for exactly one item', () => {
    expect(pluralWord(1, 'responsibility', 'responsibilities')).toBe('responsibility');
  });

  it('supports irregular plural forms', () => {
    expect(pluralWord(3, 'responsibility', 'responsibilities')).toBe('responsibilities');
    expect(countLabel(0, 'responsibility', 'responsibilities')).toBe('0 responsibilities');
  });
});
