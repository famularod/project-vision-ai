#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const sharedSheet = fs.readFileSync(
  path.join(root, 'components/project-action-sheet.tsx'),
  'utf8',
);
const documentUploadSheet = fs.readFileSync(
  path.join(root, 'components/document-upload-details-sheet.tsx'),
  'utf8',
);

assert(
  sharedSheet.includes('<ScrollView') &&
    sharedSheet.includes('style={styles.scroll}') &&
    sharedSheet.includes('contentContainerStyle={styles.scrollContent}') &&
    sharedSheet.includes('keyboardShouldPersistTaps="handled"') &&
    sharedSheet.includes('nestedScrollEnabled'),
  'Shared project action sheet must wrap overflowing content in a real scroll container.',
);

assert(
  sharedSheet.includes('PanResponder.create') &&
    sharedSheet.includes('styles.dragArea') &&
    sharedSheet.includes('{...dragResponder.panHandlers}') &&
    sharedSheet.includes('gesture.dy > 52'),
  'Shared sheet dismiss-by-drag must stay on the handle area, not the scrollable list.',
);

assert(
  sharedSheet.includes('sheet:') &&
    sharedSheet.includes("maxHeight: '82%'") &&
    sharedSheet.includes('scroll:') &&
    sharedSheet.includes('flexShrink: 1') &&
    sharedSheet.includes('scrollContent:'),
  'Sheet height and scroll styles must constrain content instead of clipping rows.',
);

[
  ['AreaSelectionSheet', 'title="Change Area"'],
  ['RecipientSelectionSheet', 'title="Recipients"'],
  ['UpdateFilterSheet', 'title="Filter Updates"'],
].forEach(([functionName, title]) => {
  const section = app.slice(
    app.indexOf(`function ${functionName}`),
    app.indexOf(`function ${functionName}`) + 2500,
  );

  assert(
    section.includes('<ProjectActionSheet') && section.includes(title),
    `${functionName} must use the shared scrollable project action sheet.`,
  );
});

assert(
  documentUploadSheet.includes('<ProjectActionSheet') &&
    documentUploadSheet.includes('title="Document Details"'),
  'DocumentUploadDetailsSheet must use the shared scrollable project action sheet.',
);

const selectProjectScreen = app.slice(
  app.indexOf('function SelectProjectScreen'),
  app.indexOf('function SelectProjectScreen') + 2600,
);
assert(
  selectProjectScreen.includes('<FlatList') &&
    selectProjectScreen.includes('data={projects}') &&
    selectProjectScreen.includes('renderItem={renderProject}') &&
    selectProjectScreen.includes('onPress={() => onSelect(project)}'),
  'Select Project must keep every project reachable through its scrollable project list.',
);

assert(
  app.includes('resolveProjectForDetectedArea(') &&
    app.includes("setProjectDetectionStatus('multiple')") &&
    app.includes("projectDetectionStatus === 'detected' ? detectedProjectName : null") &&
    app.includes("setScreen('SelectProject')"),
  'GPS ambiguity must avoid an arbitrary project default and fall back to the complete project list.',
);

console.log('Project sheet scrolling tests passed.');
