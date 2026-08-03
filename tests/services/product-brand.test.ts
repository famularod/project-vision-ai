import {
  ECOS_ARCHITECTURE,
  ECOS_BRAND,
  PRODUCT_BRAND,
  PRODUCT_POSITIONING,
} from '../../product-brand';

describe('Vitruvius product brand', () => {
  it('uses the shared Project Intelligence identity', () => {
    expect(PRODUCT_BRAND).toEqual({
      name: 'Vitruvius',
      monogram: 'V',
      subtitle: 'Project Intelligence',
    });
    expect(PRODUCT_POSITIONING).toBe('Vitruvius Project Intelligence, powered by ECOS.');
  });

  it('keeps reasoning and independent assurance separate under ECOS', () => {
    expect(ECOS_BRAND).toMatchObject({
      name: 'ECOS',
      core: 'ECOS Core',
      assurance: 'ECOS Assurance',
    });
    expect(ECOS_ARCHITECTURE.coreMayApproveOwnWork).toBe(false);
    expect(ECOS_ARCHITECTURE.assuranceIsIndependent).toBe(true);
    expect(ECOS_ARCHITECTURE.assuranceVerifies).toEqual(expect.arrayContaining([
      'evidence support',
      'permissions and authority',
      'human-approval requirements',
      'synchronization and save confirmation',
      'test and release requirements',
    ]));
  });
});
