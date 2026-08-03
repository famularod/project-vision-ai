import {
  paginateSupabaseCollection,
} from '../../services/SupabaseCollectionPagination';

describe('Supabase collection pagination request budget', () => {
  it('does not request an exact count for routine operational reads', async () => {
    const requests: Array<{ from: number; to: number; includeExactCount: boolean }> = [];
    const result = await paginateSupabaseCollection(async request => {
      requests.push(request);
      return {
        data: request.from === 0 ? ['one', 'two'] : [],
        error: null,
      };
    }, 2);

    expect(result).toMatchObject({ ok: true, rows: ['one', 'two'], exactCount: null });
    expect(requests).toEqual([
      { from: 0, to: 1, includeExactCount: false },
      { from: 2, to: 3, includeExactCount: false },
    ]);
  });

  it('retains exact-count validation for callers that explicitly request it', async () => {
    const requests: boolean[] = [];
    const result = await paginateSupabaseCollection(async request => {
      requests.push(request.includeExactCount);
      return { data: ['only'], count: 2, error: null };
    }, 5, { requestExactCount: true });

    expect(result).toMatchObject({ ok: false, code: 'count_mismatch', exactCount: 2 });
    expect(requests).toEqual([true]);
  });
});
