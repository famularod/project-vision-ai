const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const shell = read('components/web-shell/desktop-read-only-shell.tsx');
const provider = read('components/web-shell/desktop-auth-provider.tsx');
const gateway = read('services/DAVEWebSupabaseClient.ts');
const editing = read('services/DAVEWebTaskEditing.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const action of [
  'createAuthorizedScheduleItem',
  'updateAuthorizedScheduleItem',
  'deleteAuthorizedScheduleItem',
  'deleteAuthorizedReferenceDocument',
]) {
  assert(gateway.includes(action), `The desktop task gateway must implement ${action}.`);
}
assert(gateway.includes('requireAuthorizedOwner(client)'), 'Every task mutation must pass the server owner gate.');
assert(gateway.includes(".eq('owner_id', ownerId)"), 'Task updates and checks must be explicitly owner-scoped.');
assert(gateway.includes(".eq('updated_at', expectedCloudUpdatedAt)"), 'Task updates must reject stale cloud revisions.');
assert(gateway.includes(".from('dave_sync_tombstones')"), 'Task deletion must use the shared durable deletion journal.');
assert(gateway.includes("entity_type: 'schedule_item'"), 'Task deletion markers must use the shared schedule-item entity identity.');
assert(gateway.includes("entity_type: 'reference_document'"), 'Document deletion markers must use the shared reference-document entity identity.');
assert(!gateway.includes(".from('schedule_items').delete("), 'Desktop deletion must not bypass the shared tombstone contract.');
assert(!gateway.includes(".from('reference_documents').delete("), 'Desktop document deletion must not hard-delete cloud rows.');
assert(editing.includes('reconcileScheduleProgress'), 'Desktop task writes must preserve the shared status/progress invariant.');
assert(editing.includes('reconcileScheduleProgressEdit'), 'Desktop task edits must allow a completed task to be reopened safely.');
assert(editing.includes("progressSource: 'project_manager'"), 'Desktop edits must be recorded as explicit PM authority.');
assert(editing.includes('cloudUpdatedAt'), 'Desktop task models must retain the exact cloud revision for conflict checks.');
assert(provider.includes('12_000'), 'The open desktop workspace must refresh cloud truth every 12 seconds.');
assert(provider.includes('scheduleItemForCloud'), 'Browser-only revision metadata must not be persisted in task payloads.');
assert(shell.includes('+ Add Task'), 'Task creation must be directly accessible on the Tasks page.');
assert(shell.includes('Choose an existing value when available, or type the correct value manually.'), 'Task fields must support choices plus manual entry.');
assert(shell.includes('Save Task Changes') && shell.includes('Delete Task'), 'Desktop tasks must expose explicit edit and protected delete actions.');
assert(shell.includes('permanent deletion marker'), 'The delete confirmation must explain resurrection protection.');
assert(shell.includes('style={[styles.dataCard, styles.taskListCard]}'), 'Vertical task rows must use the compact list-card style.');
assert(shell.includes('gridDataCard: { flexGrow: 1, flexBasis: 320 }'), 'Flexible card growth must remain limited to dashboard grids.');
assert(!/dataCard:\s*\{[^}]*flexGrow/.test(shell), 'The shared card style must not stretch vertical list rows.');
assert(shell.includes('<TaskStatusBadge task={task} />'), 'Task cards must use the prominent task-specific status treatment.');
assert(shell.includes("const label = isComplete ? 'Completed' : task.status;"), 'Completed tasks must use a clear past-tense status label.');
assert(shell.includes("isNotStarted ? 'notStarted' : 'inProgress'"), 'Not-started work must be visually distinct from work in progress.');
assert(shell.includes('taskStatusBadge: { minWidth: 116'), 'Task status pills must be large enough to scan quickly.');
assert(shell.includes('Delete Document Only') && shell.includes('Delete Document +'), 'Document deletion must distinguish keeping or deleting linked tasks.');
assert(shell.includes('This is the current schedule and is protected'), 'The current schedule must be protected from accidental deletion.');
assert(shell.includes('Prior schedule versions ('), 'Schedule history must be separated from the authoritative current schedule.');
assert(shell.includes('groupDAVEWebDocuments'), 'Document management must use the tested schedule-version grouping contract.');
assert(shell.includes('permanent cloud deletion marker'), 'Document deletion must explain cross-device resurrection protection.');
const currentScheduleStart = shell.indexOf('title="Current schedule"');
const nextDocumentGroup = shell.indexOf('<DocumentGroup', currentScheduleStart + 1);
const currentScheduleBlock = shell.slice(currentScheduleStart, nextDocumentGroup);
assert(currentScheduleStart >= 0 && nextDocumentGroup > currentScheduleStart, 'The current schedule section must remain explicit.');
assert(!currentScheduleBlock.includes('onDelete='), 'The protected current schedule must not expose a Delete action.');
assert(shell.includes('{onDelete ? ('), 'Only explicitly deletable document groups may render a Delete action.');
assert(!gateway.includes("from '@react-native-async-storage/async-storage'"), 'Desktop task writes must not import native AsyncStorage.');
assert(!gateway.includes("from 'expo-secure-store'"), 'Desktop task writes must not import native SecureStore.');

console.log('PASS Phase 4 controlled desktop task editing');
