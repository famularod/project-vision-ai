import { currentDraftLocationNoticeView, draftAreaPresentation } from '../../services/DraftAreaPresentation';

const base = { selectedArea: null, selectedAreaName: 'Roof staging', areaSuggestion: null, hasScheduleRecommendation: true };
const reason = (scheduleRecommendationAreaName?: string) => draftAreaPresentation({ ...base, scheduleRecommendationAreaName }).reason;

describe('4.39: a named location needs the recommendation identity', () => {
  it.each([undefined, 'North Pad', 'Roof staging annex'])('does not attribute a location to another recommendation: %s', name => {
    expect(reason(name)).toBe('This is the location named on this update.');
  });
  it('retains the schedule reason when the actual recommendation names this location', () => {
    expect(reason(' roof STAGING ')).toBe('The imported schedule identifies this as the most urgent area.');
  });
  it('a saved manual selection does not gain schedule provenance even when names match', () => {
    expect(draftAreaPresentation({ ...base, selectedArea: { id: 'roof', name: 'Roof staging' }, scheduleRecommendationAreaName: 'Roof staging' }).reason)
      .toBe('This is your current confirmed selection.');
  });
});

describe('4.38: an in-memory capture reason stays true after Settings changes', () => {
  it.each(['denied', 'precise-off'] as const)('%s: same draft and capture stay historical without a new fix', kind => {
    const draft = { id: 'draft', gpsLatitude: null, gpsLongitude: null };
    const notice = { draftId: 'draft', generation: 7, kind };
    const before = JSON.stringify({ draft, notice });
    const detail = currentDraftLocationNoticeView({ notice, generation: 7, draft, areas: [] });
    const text = draftAreaPresentation({ ...base, locationNotice: detail }).locationNotice;
    expect(text).toContain('when this update was started');
    expect(text).not.toMatch(/permission denied|Location is off|only gets/);
    expect(JSON.stringify({ draft, notice })).toBe(before);
    expect(currentDraftLocationNoticeView({ notice, generation: 8, draft, areas: [] })).toBeNull();
  });
});
