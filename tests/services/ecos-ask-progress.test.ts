import { ecosAskElapsedLabel, ecosAskProgressStage } from '../../services/ECOSAskProgress';

describe('Ask ECOS wait progress', () => {
  it('moves through plain-language stages as time passes and never claims a step finished', () => {
    expect(ecosAskProgressStage(0).key).toBe('finding');
    expect(ecosAskProgressStage(10).key).toBe('reading');
    expect(ecosAskProgressStage(35).key).toBe('writing');
    expect(ecosAskProgressStage(50).key).toBe('checking');
    expect(ecosAskProgressStage(120).key).toBe('longer');
    for (const seconds of [0, 10, 35, 50, 120]) {
      const stage = ecosAskProgressStage(seconds);
      expect(stage.title.endsWith('…')).toBe(true);
      expect(/\b(done|finished|complete)\b/i.test(stage.title)).toBe(false);
    }
    expect(ecosAskProgressStage(Number.NaN).key).toBe('finding');
  });

  it('formats elapsed time for a phone', () => {
    expect(ecosAskElapsedLabel(0)).toBe('0 s');
    expect(ecosAskElapsedLabel(38.9)).toBe('38 s');
    expect(ecosAskElapsedLabel(95)).toBe('1 min 35 s');
  });
});
