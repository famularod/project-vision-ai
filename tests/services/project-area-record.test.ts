/**
 * Work-area normalization, tested directly.
 *
 * These assertions previously had to live in the app-shell smoke test, because
 * the only way to reach normalizeProjectArea was to import App.tsx and that
 * needs the whole native-module mock set. Extracting the behaviour to
 * services/ProjectAreaRecord.ts is what makes this file possible, and the
 * absence of a single jest.mock here is the point.
 */
import {
  DEFAULT_PROJECT_AREAS,
  normalizeProjectArea,
} from '../../services/ProjectAreaRecord';

describe('normalizeProjectArea', () => {
  it('keeps a field this build does not manage', () => {
    // The defect that cost 148 schedule tasks an endless retry loop was a
    // normalizer rebuilding records from an explicit field list. Work areas
    // have no revision check to catch it, so a dropped field would be written
    // back over the good cloud copy in silence.
    const normalized = normalizeProjectArea({
      id: 'area-1',
      name: 'North Lot',
      legacyProvenanceKey: 'written-by-another-surface',
    } as never) as Record<string, unknown>;

    expect(normalized.legacyProvenanceKey).toBe('written-by-another-surface');
    expect(normalized.name).toBe('North Lot');
  });

  it('still sanitizes managed fields rather than trusting the input', () => {
    expect(normalizeProjectArea({ id: 'area-1', name: '   ' } as never).name)
      .toBe('New Area');
    expect(normalizeProjectArea({ id: 'area-1', projectName: '  ' } as never).projectName)
      .toBeNull();
  });

  it('assigns an id when the record has none', () => {
    const normalized = normalizeProjectArea({ name: 'North Lot' } as never);

    expect(typeof normalized.id).toBe('string');
    expect(normalized.id.length).toBeGreaterThan(0);
  });

  it('falls back to the first seeded area location when coordinates are absent', () => {
    // Preserved from the original implementation rather than improved on. The
    // coupling to a seeded area is a smell, but changing it here would be a
    // behaviour change hiding inside an extraction.
    const normalized = normalizeProjectArea({ id: 'area-1', name: 'North Lot' } as never);

    expect(normalized.latitude).toBe(DEFAULT_PROJECT_AREAS[0].latitude);
    expect(normalized.longitude).toBe(DEFAULT_PROJECT_AREAS[0].longitude);
    expect(normalized.radiusFeet).toBe(250);
  });

  it('rejects a non-finite or non-positive radius', () => {
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY, '250']) {
      expect(normalizeProjectArea({ id: 'a', radiusFeet: bad } as never).radiusFeet)
        .toBe(250);
    }
  });

  it('seeds twelve areas that all carry a location', () => {
    expect(DEFAULT_PROJECT_AREAS).toHaveLength(12);
    for (const area of DEFAULT_PROJECT_AREAS) {
      expect(Number.isFinite(area.latitude)).toBe(true);
      expect(Number.isFinite(area.longitude)).toBe(true);
    }
  });
});
