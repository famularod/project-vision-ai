#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const projectDocumentsHeader = fs.readFileSync(
  path.join(root, 'components/project-documents-header.tsx'),
  'utf8',
);
const documentClassification = fs.readFileSync(
  path.join(root, 'services/ProjectDocumentClassification.ts'),
  'utf8',
);
const documentUploadDetails = fs.readFileSync(
  path.join(root, 'components/document-upload-details-sheet.tsx'),
  'utf8',
);
const documentRuntimeSource = `${app}\n${projectDocumentsHeader}\n${documentClassification}\n${documentUploadDetails}`;
const fileSizePreflight = fs.readFileSync(
  path.join(root, 'services/FileSizePreflight.ts'),
  'utf8',
);
const projectDocumentsScreen = app.slice(
  app.indexOf('function ProjectDocumentsScreen'),
  app.indexOf('function ReferenceDocumentsScreen'),
);

[
  "type ProjectDocument = {",
  "type ProjectDocumentCategory =",
  "type ProjectDocumentStatus =",
  "const PROJECT_DOCUMENT_CATEGORIES",
  "const COMPLIANCE_SENSITIVE_DOCUMENT_CATEGORIES",
  "PROJECT_DOCUMENTS_STORAGE_KEY",
  "ProjectDocumentsScreen",
  "ProjectDocumentCard",
  "ProjectDocumentInlineRow",
  "Upload Document",
  "Take Photo of Document",
  "View Document",
  "Retry Upload",
  "Local only",
  "Document upload pending",
  "Document upload failed · Retry",
  "Uploaded",
  "No documents yet — upload your first document.",
  "Possible duplicate document",
  "Upload Anyway",
  "projectDocumentStatusDetail",
  "duplicateProjectDocumentForAsset",
  "retryProjectDocumentUpload",
  "buildProjectDocumentStoragePath",
  "buildProjectDocumentMetadataBrief",
  "isComplianceSensitiveProjectDocument",
  "Archive compliance-sensitive document?",
  "Attach to Area",
  "Attach to Update",
  "Add note",
  "Document Type",
  "suggestProjectDocumentCategory(asset)",
  "selectedCategory",
].forEach(marker => {
  assert(documentRuntimeSource.includes(marker), `Phase 6 documents foundation should include ${marker}`);
});

assert(
  app.includes('await preflightExpoFileRead({ uri: asset.uri, reportedSizeBytes: asset.size })') &&
    app.includes('error instanceof FileSizePreflightError') &&
    fileSizePreflight.includes("code: 'file_too_large'") &&
    fileSizePreflight.includes('Choose a smaller file and retry.'),
  'Project documents must reject oversized files before copying or uploading them.',
);

[
  "Schedule",
  "Permit Card",
  "Drawing",
  "Scope",
  "Contract",
  "Inspection",
  "Safety",
  "Compliance",
  "RFI / Field Decision",
  "Vendor Document",
  "Other",
].forEach(category => {
  assert(documentRuntimeSource.includes(`'${category}'`), `Project documents should support ${category}`);
});

assert(
  app.includes("status: 'local'") &&
    app.includes("status: 'uploading'") &&
    app.includes("status: result.ok ? 'uploaded' : 'failed'"),
  'Documents should preserve local state, show upload progress, and persist failed/uploaded results.',
);

assert(
  app.includes("bucket: PROJECT_DOCUMENT_UPLOAD_FOLDER") &&
    app.includes('upsert: true') &&
    app.includes('uploadAttemptCount'),
  'Document upload retry should use a stable storage path and idempotent upsert behavior.',
);

assert(
  app.includes("type: [\n          'application/pdf'") &&
    app.includes("'application/vnd.openxmlformats-officedocument.wordprocessingml.document'") &&
    app.includes("'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'") &&
    app.includes("'text/csv'") &&
    app.includes("'text/plain'"),
  'Upload Document should support PDF, image, Word, Excel, CSV, and text files.',
);

assert(
  app.includes('projectDocumentsForScopes(') &&
    app.includes('workspaceScopeNames(selectedWorkspaceProject)') &&
    app.includes("onOpenDocuments={() => setScreen('ProjectDocuments')}"),
  'Project Workspace Documents tool should open documents across the parent project scope.',
);

assert(
  app.includes('not included as an uploaded attachment') &&
    !app.includes('signed URL') &&
    !app.includes('signedUrl'),
  'Unavailable documents should not be exposed as broken links or signed URLs.',
);

assert(
  !app.includes('EXPO_PUBLIC_OPENAI_API_KEY') &&
    !app.includes('EXPO_PUBLIC_AI_PROVIDER') &&
    !app.includes('EXPO_PUBLIC_OPENAI_MODEL') &&
    !projectDocumentsScreen.includes('OpenAI') &&
    !projectDocumentsScreen.includes('ocr') &&
    !projectDocumentsScreen.includes('OCR'),
  'Project Documents foundation must not use client OpenAI, OCR, or AI document parsing.',
);

console.log('Phase 6 documents foundation tests passed.');
