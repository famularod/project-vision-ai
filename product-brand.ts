import productMetadata from './product-metadata.json';

export const PRODUCT_BRAND = Object.freeze({
  name: productMetadata.name,
  monogram: productMetadata.monogram,
  subtitle: productMetadata.subtitle,
});

export const PRODUCT_RELEASE = Object.freeze({
  version: productMetadata.version,
  build: productMetadata.build,
});
