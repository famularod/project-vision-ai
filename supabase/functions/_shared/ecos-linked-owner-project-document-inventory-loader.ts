// Fixed owner /2.1 wrapper over the private sweep shared with legacy /2.0.
// No compatibility casts or customer-supplied protocol adapters are exposed.
export {
  type ECOSLinkedDocumentInventoryLoaderOptions,
  type ECOSLinkedOwnerProjectDocumentInventoryRPC,
  type ECOSLinkedProjectDocumentInventoryRequest
    as ECOSLinkedOwnerProjectDocumentInventoryRequest,
  loadECOSLinkedOwnerProjectDocumentInventory,
} from './ecos-linked-project-document-inventory-loader.ts';
