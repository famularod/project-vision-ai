#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');

const sharedSheet = app.slice(
  app.indexOf('function ProjectActionSheet'),
  app.indexOf('function ProjectSelectorRow'),
);

assert(
  sharedSheet.includes('<ScrollView') &&
    sharedSheet.includes('style={styles.projectSelectorScroll}') &&
    sharedSheet.includes('contentContainerStyle={styles.projectSelectorScrollContent}') &&
    sharedSheet.includes('keyboardShouldPersistTaps="handled"') &&
    sharedSheet.includes('nestedScrollEnabled'),
  'Shared project action sheet must wrap overflowing content in a real scroll container.',
);

assert(
  sharedSheet.includes('PanResponder.create') &&
    sharedSheet.includes('styles.projectSelectorDragHandleArea') &&
    sharedSheet.includes('{...dragResponder.panHandlers}') &&
    sharedSheet.includes('gesture.dy > 52'),
  'Shared sheet dismiss-by-drag must stay on the handle area, not the scrollable list.',
);

assert(
  app.includes('projectSelectorSheet:') &&
    app.includes("maxHeight: '82%'") &&
    app.includes('projectSelectorScroll:') &&
    app.includes('flexShrink: 1') &&
    app.includes('projectSelectorScrollContent:'),
  'Sheet height and scroll styles must constrain content instead of clipping rows.',
);

[
  ['ProjectSelectorSheet', 'title="Choose Project"'],
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
  app.includes('{projects.map(project => (') &&
    app.includes('label={project}') &&
    app.includes('onPress={() => onSelect(project)}'),
  'Choose Project must keep every project reachable through the scrollable project list.',
);

assert(
  app.includes('resolveProjectForDetectedArea(') &&
    app.includes('suggestedArea') &&
    app.includes('GPS found multiple nearby projects'),
  'GPS defaulting and multi-candidate picker context must remain intact.',
);

console.log('Project sheet scrolling tests passed.');
