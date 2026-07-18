import {
  classifyDAVEBlocker,
  classifyDAVECompletion,
  classifyDAVEImplementation,
  classifyDAVEIssue,
  classifyDAVEOutcome,
  classifyDAVESafety,
  parseDAVEAssertions,
} from '../../services/DAVEAssertionParser';

describe('DAVE assertion parser', () => {
  it('normalizes an affirmative completion claim and preserves its source span', () => {
    const source = 'Electrical rough-in is complete.';
    const parsed = parseDAVEAssertions(source);

    expect(parsed.assertions).toHaveLength(1);
    expect(parsed.assertions[0]).toMatchObject({
      subject: 'electrical rough-in',
      predicate: 'complete',
      status: 'complete',
      polarity: 'affirmed',
      temporality: 'current',
      modality: 'unknown',
      sourceSpan: {
        start: 0,
        end: source.length - 1,
        text: 'Electrical rough-in is complete',
      },
    });
    expect(parsed.assertions[0].confidence).toBeGreaterThan(0);
    expect(parsed.assertions[0].confidence).toBeLessThanOrEqual(1);
    expect(classifyDAVECompletion(parsed)).toBe('complete');
  });

  it.each([
    ['Electrical rough-in is not complete.', 'incomplete'],
    ['Electrical rough-in is incomplete.', 'incomplete'],
    ['Electrical rough-in has not started.', 'not_started'],
    ['Electrical rough-in is still in progress.', 'in_progress'],
  ] as const)('keeps %s out of the complete classification', (source, status) => {
    const parsed = parseDAVEAssertions(source);

    expect(parsed.assertions[0]).toMatchObject({ status });
    expect(classifyDAVECompletion(parsed)).toBe('not_complete');
  });

  it('does not confuse approval language with completion', () => {
    const parsed = parseDAVEAssertions('The inspection is not approved.');

    expect(parsed.assertions).toHaveLength(1);
    expect(parsed.assertions[0]).toMatchObject({
      subject: 'inspection',
      predicate: 'approved',
      status: 'not_approved',
      polarity: 'negated',
    });
    expect(classifyDAVECompletion(parsed)).toBe('no_assertion');
  });

  it('records a future plan without promoting it to current completion', () => {
    const parsed = parseDAVEAssertions('The work will be complete tomorrow.');

    expect(parsed.assertions[0]).toMatchObject({
      subject: 'work',
      predicate: 'complete',
      polarity: 'affirmed',
      temporality: 'future',
      modality: 'planned',
    });
    expect(classifyDAVECompletion(parsed)).toBe('no_assertion');
  });

  it('treats no safety issues observed as an observed negative safety assertion', () => {
    const parsed = parseDAVEAssertions('No safety issues observed.');

    expect(parsed.assertions[0]).toMatchObject({
      subject: 'safety issue',
      predicate: 'safety_issue_present',
      status: 'safety_clear',
      polarity: 'negated',
      temporality: 'unspecified',
      modality: 'observed',
    });
    expect(classifyDAVESafety(parsed)).toBe('no_issue_observed');
  });

  it('keeps an unresolved blocker classified as blocked', () => {
    const parsed = parseDAVEAssertions('The blocker is not resolved.');

    expect(parsed.assertions[0]).toMatchObject({
      subject: 'blocker',
      predicate: 'blocker_resolved',
      status: 'blocker_unresolved',
      polarity: 'negated',
      temporality: 'current',
    });
    expect(classifyDAVEBlocker(parsed)).toBe('blocked');
  });

  it.each([
    ['The work might be complete.', 'unknown'],
    ['The work will be complete if inspection passes.', 'conditional'],
  ] as const)('keeps uncertain claim %s out of current truth', (source, modality) => {
    const parsed = parseDAVEAssertions(source);

    expect(parsed.assertions[0]).toMatchObject({
      predicate: 'complete',
      polarity: 'uncertain',
      modality,
    });
    expect(classifyDAVECompletion(parsed)).not.toBe('complete');
  });

  it('flags contradictory current completion claims', () => {
    const parsed = parseDAVEAssertions(
      'Electrical rough-in is complete, but electrical rough-in is not complete.',
    );

    expect(parsed.assertions).toHaveLength(2);
    expect(parsed.conflicts).toEqual([{
      domain: 'completion',
      assertionIndexes: [0, 1],
    }]);
    expect(classifyDAVECompletion(parsed)).toBe('conflicting');
  });

  it('does not call a current negative and a future plan a contradiction', () => {
    const parsed = parseDAVEAssertions(
      'The work is not complete now, but it will be complete tomorrow.',
    );

    expect(parsed.conflicts).toEqual([]);
    expect(classifyDAVECompletion(parsed)).toBe('not_complete');
  });

  it('does not call opposite statuses for different subjects a contradiction', () => {
    const parsed = parseDAVEAssertions(
      'Canopy A is complete, but Canopy B is not complete.',
    );

    expect(parsed.assertions.map(assertion => assertion.subject)).toEqual([
      'canopy a',
      'canopy b',
    ]);
    expect(parsed.conflicts).toEqual([]);
  });

  it('flags conflicting safety and blocker statements independently', () => {
    const safety = parseDAVEAssertions(
      'No safety issues observed, but a safety issue is present.',
    );
    const blocker = parseDAVEAssertions(
      'The blocker is resolved, but the blocker is not resolved.',
    );

    expect(classifyDAVESafety(safety)).toBe('conflicting');
    expect(classifyDAVEBlocker(blocker)).toBe('conflicting');
  });

  it('keeps implementation and outcome decisions polarity- and time-aware', () => {
    expect(classifyDAVEImplementation('The installation is not complete.')).toBe('in_progress');
    expect(classifyDAVEImplementation('The installation was implemented.')).toBe('no_assertion');
    expect(classifyDAVEImplementation('The installation will be implemented tomorrow.')).toBe('no_assertion');
    expect(classifyDAVEOutcome('The inspection passed.')).toBe('successful');
    expect(classifyDAVEOutcome('The inspection failed.')).toBe('unsuccessful');
    expect(classifyDAVEOutcome('The inspection might pass if power is available.')).toBe('uncertain');
  });

  it('does not turn explicit clear language into an issue or blocker', () => {
    expect(classifyDAVEIssue('No issues were observed.')).toBe('no_issue_observed');
    expect(classifyDAVEBlocker('The work is not blocked.')).toBe('resolved');
    expect(classifyDAVESafety('The area is not unsafe.')).toBe('no_issue_observed');
  });
});
