import productMetadata from './product-metadata.json';

export const PRODUCT_BRAND = Object.freeze({
  name: productMetadata.name,
  monogram: productMetadata.monogram,
  subtitle: productMetadata.subtitle,
});

export const PRODUCT_POSITIONING = 'Vitruvius Project Intelligence, powered by ECOS.';

export const ECOS_BRAND = Object.freeze({
  name: 'ECOS',
  core: 'ECOS Core',
  assurance: 'ECOS Assurance',
  analysis: 'ECOS Analysis',
  review: 'ECOS Review',
  confidence: 'ECOS Confidence',
  memory: 'ECOS Memory',
  evidence: 'ECOS Evidence',
  reasoning: 'ECOS Reasoning',
});

export const ECOS_ARCHITECTURE = Object.freeze({
  statement: 'Vitruvius is the product. ECOS is the intelligence system. ECOS Core reasons. ECOS Assurance verifies.',
  coreMayApproveOwnWork: false,
  assuranceIsIndependent: true,
  assuranceVerifies: Object.freeze([
    'evidence support',
    'confidence levels',
    'project and record identity',
    'permissions and authority',
    'business-rule compliance',
    'human-approval requirements',
    'synchronization and save confirmation',
    'test and release requirements',
  ]),
});

export const PRODUCT_RELEASE = Object.freeze({
  version: productMetadata.version,
  build: productMetadata.build,
});
