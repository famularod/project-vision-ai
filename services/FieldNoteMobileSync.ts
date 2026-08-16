import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createFieldNoteCloudGateway,
  FieldNoteCloudError,
  sameFieldNoteContent,
  type FieldNoteCloudGateway,
  type FieldNoteCloudRealtimeStatus,
} from './FieldNoteCloudGateway';
import {
  localFieldNoteRepository,
  markFieldNoteConflict,
  normalizeFieldNote,
  type FieldNote,
} from './FieldNoteRepository';
import { getSupabaseClient } from './SupabaseService';

export type FieldNoteWorkspaceDataSource = Readonly<{
  list: (ownerKey: string) => Promise<readonly FieldNote[]>;
  save: (ownerKey: string, note: FieldNote) => Promise<FieldNote>;
  update: (ownerKey: string, note: FieldNote) => Promise<FieldNote>;
  retryPending?: (ownerKey: string) => Promise<readonly FieldNote[]>;
  subscribe?: (
    ownerKey: string,
    onChange: (notes: readonly FieldNote[]) => void,
    onStatus?: (status: FieldNoteCloudRealtimeStatus) => void,
  ) => Promise<() => void>;
}>;

type LocalFieldNoteRepository = typeof localFieldNoteRepository;

export function createMobileFieldNoteDataSource({
  localRepository,
  cloudGateway,
}: Readonly<{
  localRepository: LocalFieldNoteRepository;
  cloudGateway: FieldNoteCloudGateway;
}>): FieldNoteWorkspaceDataSource {
  async function persistMerged(
    ownerKey: string,
    cloudNotes: readonly FieldNote[],
  ): Promise<readonly FieldNote[]> {
    const localNotes = await localRepository.list(ownerKey);
    const merged = mergeFieldNoteCollections(localNotes, cloudNotes);
    return localRepository.replaceAll(ownerKey, merged);
  }

  async function syncOne(ownerKey: string, note: FieldNote): Promise<FieldNote> {
    const local = normalizeFieldNote(note);
    try {
      const cloud = local.revision > 0
        ? await cloudGateway.update(local, local.revision)
        : await cloudGateway.create(local);
      await localRepository.replace(ownerKey, cloud);
      return cloud;
    } catch (error) {
      if (error instanceof FieldNoteCloudError && error.code === 'conflict') {
        try {
          const merged = await persistMerged(ownerKey, await cloudGateway.list());
          const rebased = merged.find(item => item.id === local.id);
          if (rebased?.syncState === 'pending' && rebased.revision > local.revision) {
            const cloud = await cloudGateway.update(rebased, rebased.revision);
            await localRepository.replace(ownerKey, cloud);
            return cloud;
          }
          if (rebased) return rebased;
        } catch {
          // Preserve the local version below if recovery cannot reach the cloud.
        }
        const conflicted = markFieldNoteConflict(local, error.message);
        await localRepository.replace(ownerKey, conflicted);
        return conflicted;
      }
      const waiting = markFieldNoteWaiting(local, cloudWaitingMessage(error));
      await localRepository.replace(ownerKey, waiting);
      return waiting;
    }
  }

  async function retryPending(ownerKey: string): Promise<readonly FieldNote[]> {
    const notes = await localRepository.list(ownerKey);
    for (const note of notes) {
      if (note.syncState === 'pending') await syncOne(ownerKey, note);
    }
    return localRepository.list(ownerKey);
  }

  return Object.freeze({
    async list(ownerKey) {
      let notes = await localRepository.list(ownerKey);
      try {
        notes = await persistMerged(ownerKey, await cloudGateway.list());
      } catch {
        // Local-first: a failed refresh must not hide safely persisted notes.
      }
      if (notes.some(note => note.syncState === 'pending')) {
        notes = await retryPending(ownerKey);
      }
      return notes;
    },

    async save(ownerKey, note) {
      const local = await localRepository.save(ownerKey, note);
      return syncOne(ownerKey, local);
    },

    async update(ownerKey, note) {
      const local = await localRepository.replace(ownerKey, note);
      return syncOne(ownerKey, local);
    },

    retryPending,

    async subscribe(ownerKey, onChange, onStatus) {
      return cloudGateway.subscribe(async cloudNote => {
        try {
          const notes = await persistMerged(ownerKey, [cloudNote]);
          onChange(notes);
        } catch {
          // The next foreground refresh remains the recovery path.
        }
      }, status => {
        onStatus?.(status);
        if (status === 'subscribed') {
          void retryPending(ownerKey).then(onChange).catch(() => undefined);
        }
      });
    },
  });
}

export function mergeFieldNoteCollections(
  localNotes: readonly FieldNote[],
  cloudNotes: readonly FieldNote[],
): readonly FieldNote[] {
  const merged = new Map(localNotes.map(note => [note.id, normalizeFieldNote(note)]));
  for (const rawCloud of cloudNotes) {
    const cloud = normalizeFieldNote(rawCloud);
    const local = merged.get(cloud.id);
    if (!local || local.syncState === 'synced') {
      merged.set(cloud.id, cloud);
      continue;
    }
    if (sameFieldNoteContent(local, cloud)) {
      merged.set(cloud.id, cloud);
      continue;
    }
    if (cloud.revision > local.revision) {
      if (local.revision === 0) {
        merged.set(
          cloud.id,
          markFieldNoteConflict(
            local,
            'This field note ID already contains different information in the cloud.',
          ),
        );
      } else if (local.status !== cloud.status) {
        merged.set(cloud.id, rebaseMobileStatusChange(local, cloud));
      } else {
        // Desktop owns content editing. When mobile has no distinct pending
        // status change, accept the newer reviewed desktop record.
        merged.set(cloud.id, cloud);
      }
    }
  }
  return Object.freeze(
    [...merged.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)),
  );
}

function rebaseMobileStatusChange(local: FieldNote, cloud: FieldNote): FieldNote {
  const updatedAt = timestampAfter(local.updatedAt, cloud.updatedAt);
  return Object.freeze({
    ...cloud,
    status: local.status,
    updatedAt,
    resolvedAt: local.status === 'resolved' ? local.resolvedAt || updatedAt : null,
    archivedAt: local.status === 'archived' ? local.archivedAt || updatedAt : null,
    syncState: 'pending' as const,
    syncError: null,
  });
}

function timestampAfter(left: string, right: string): string {
  const latest = Math.max(Date.parse(left), Date.parse(right), Date.now());
  return new Date(latest + 1).toISOString();
}

function markFieldNoteWaiting(note: FieldNote, message: string): FieldNote {
  return Object.freeze({
    ...normalizeFieldNote(note),
    syncState: 'pending' as const,
    syncError: message,
  });
}

function cloudWaitingMessage(error: unknown): string {
  if (error instanceof FieldNoteCloudError) return error.message;
  return 'Saved on this device. Vitruvius will synchronize it automatically.';
}

async function requireMobileFieldNoteOwner(client: SupabaseClient): Promise<string> {
  const { data: userResult, error: userError } = await client.auth.getUser();
  const ownerId = userResult.user?.id?.trim() ?? '';
  if (userError || !ownerId) {
    throw new FieldNoteCloudError(
      'authorization',
      'Sign in is required before Field Notes can synchronize.',
    );
  }
  const { data: authorized, error } = await client.rpc('dave_is_app_owner');
  if (error || authorized !== true) {
    throw new FieldNoteCloudError(
      'authorization',
      'This account is not authorized to synchronize Field Notes.',
    );
  }
  return ownerId;
}

const mobileClient = getSupabaseClient();
const mobileCloudGateway = createFieldNoteCloudGateway(
  mobileClient,
  async () => {
    if (!mobileClient) {
      throw new FieldNoteCloudError(
        'authorization',
        'Cloud synchronization is not configured on this device.',
      );
    }
    return requireMobileFieldNoteOwner(mobileClient);
  },
);

export const mobileFieldNoteDataSource = createMobileFieldNoteDataSource({
  localRepository: localFieldNoteRepository,
  cloudGateway: mobileCloudGateway,
});
