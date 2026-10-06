/**
 * Everyday item 9 (2 Oct 2026): VoiceOver did not read a field update
 * card's "Document change waiting to sync" line. The card is one button with
 * its own label, and VoiceOver reads that label, not the lines inside it. The
 * label now says the line while it shows. The hook is the one the line
 * itself uses (real queue snapshot, real rule).
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { act, render, screen } from '@testing-library/react-native';
import React from 'react';

import {
  FIELD_UPDATE_DOCUMENT_CHANGE_WAITING_TEXT,
  FieldUpdateDocumentChangeNotice,
  useFieldUpdateDocumentChangeWaiting,
} from '../../components/field-update-document-change-notice';
import * as notice from '../../services/FieldUpdateDocumentChangeNotice';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');

const patchItem = (updateId: string, lastError: string | null) => ({
  id: `queue-${updateId}`,
  entity: 'project_update',
  operation: 'upsert',
  payload: { id: updateId, documentPatches: [{ kind: 'document', documentId: 'doc-1', changedFields: ['status'] }] },
  createdAt: '2026-10-02T09:00:00.000Z',
  retryCount: lastError ? 1 : 0,
  lastError,
});

/** App.tsx's own UpdateHistoryCard (module level), compiled with its real hooks and React Native parts. */
function compileUpdateHistoryCard(): (props: Record<string, unknown>) => React.ReactElement {
  const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
  const start = app.indexOf('\nfunction UpdateHistoryCard(');
  const open = app.indexOf(') {\n', start) + 2;
  let depth = 0;
  let end = open;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) { end = index + 1; break; }
    }
  }
  const js = ts.transpileModule(`${app.slice(start, end)}\nmodule.exports = { UpdateHistoryCard };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  const { View, Text, TouchableOpacity, Image } = jest.requireActual('react-native');
  const deps: Record<string, unknown> = {
    React, useState: React.useState, View, Text, TouchableOpacity, Image, __DEV__: false,
    Ionicons: () => null, styles: new Proxy({}, { get: () => ({}) }), colors: new Proxy({}, { get: () => '#000' }),
    useProjectPhotoDisplayUri: () => ({ uri: null, onError: () => undefined }), resolveProjectPhotoUri: () => null,
    useFieldUpdateConflictReview: () => false, useFieldUpdateDocumentChangeWaiting,
    FIELD_UPDATE_CONFLICT_REVIEW_LABEL: 'Needs Review', FIELD_UPDATE_DOCUMENT_CHANGE_WAITING_TEXT,
    queuedStatusCopyForUpdate: () => 'Waiting to sync', countLabel: (count: number, word: string) => `${count} ${word}`,
    fieldUpdateLifecycleLabel: () => 'Sent', relativeUpdateTimestamp: () => 'Today', DELETED_TASK_EVIDENCE_LABEL: 'Deleted task',
    FieldUpdateDocumentChangeNotice, retryOverConflictConfirmed: () => undefined, UpdateOverflowMenu: () => null,
  };
  const mod = { exports: {} as { UpdateHistoryCard: (props: Record<string, unknown>) => React.ReactElement } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports.UpdateHistoryCard;
}

const fieldUpdate = (id: string) => ({
  id, projectName: 'Tower', date: '2026-10-02', notes: '', photos: [], documents: [{ id: 'doc-1' }],
  observedFindings: ['Slab poured'], quickContext: 'Photo update', status: 'sent',
});

describe('VoiceOver reads the card\'s "Document change waiting to sync" line (everyday item 9)', () => {
  it('the App\'s update card says it in its VoiceOver label exactly while the line shows', async () => {
    const UpdateHistoryCard = compileUpdateHistoryCard();
    const card = (id: string) => (
      <UpdateHistoryCard update={fieldUpdate(id)} lifecycle="sent" pieStatus={null}
        onOpen={() => undefined} onDelete={() => undefined} onArchive={() => undefined} />
    );
    const snapshot = jest.spyOn(notice, 'queuedDocumentChangesSnapshot');
    // Its upload failed: the line shows, and the card's label says it.
    snapshot.mockReturnValue([patchItem('u1', 'Network request failed')] as never);
    const view = render(card('u1'));
    // The first card to subscribe reads the saved queue once; that read lands here, not after the test.
    await act(async () => { for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(screen.getByText(FIELD_UPDATE_DOCUMENT_CHANGE_WAITING_TEXT)).toBeTruthy();
    expect(screen.getByLabelText(`Tower. Slab poured. Photo update. Sent. ${FIELD_UPDATE_DOCUMENT_CHANGE_WAITING_TEXT}. Today`)).toBeTruthy();
    // Nothing waiting: no line, and the label reads as before.
    snapshot.mockReturnValue([] as never);
    view.rerender(card('u2'));
    expect(screen.queryByText(FIELD_UPDATE_DOCUMENT_CHANGE_WAITING_TEXT)).toBeNull();
    expect(screen.getByLabelText('Tower. Slab poured. Photo update. Sent. Today')).toBeTruthy();
    snapshot.mockRestore();
  });

  it('the card takes it from the same hook as the line itself', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain('const documentChangeWaiting = useFieldUpdateDocumentChangeWaiting(update.id);');
    expect(app).toContain('${statusLabel}. ${documentChangeWaiting ? `${FIELD_UPDATE_DOCUMENT_CHANGE_WAITING_TEXT}. ` : \'\'}');
  });
});
