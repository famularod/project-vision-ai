import { PRODUCT_BRAND } from '../../product-brand';

describe('Vitruvius product brand', () => {
  it('uses the shared Project Intelligence identity', () => {
    expect(PRODUCT_BRAND).toEqual({
      name: 'Vitruvius',
      monogram: 'V',
      subtitle: 'Project Intelligence',
    });
  });
});
