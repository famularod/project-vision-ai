/**
 * The two-device rig of tests/services/owner-answer-q28-conflicts-not-overwrite.test.ts, for another test file
 * (review N2, 5 Oct 2026): two devices and one cloud, each device with its own storage and its own SyncService,
 * running App.tsx's own code compiled from its source. The rig is that test file's own text up to its first
 * `describe`, compiled here and run inside the calling test file, so its mocks are that file's mocks: there is one
 * copy of the rig, and a change to it reaches every test built on it. The calling test file must sit in
 * tests/services, as the rig's own paths are written from there.
 *
 * A name the rig no longer has fails here, by name. What the rig imports only for its own tests is not part of it:
 * a test file imports that itself.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export type RigUpdate = Record<string, any> & { id: string; status: string };
export type RigDevice = {
  name: 'phone' | 'ipad';
  m: { sync: typeof import('../../services/SyncService') };
  updates: RigUpdate[];
  updatesRef: { current: RigUpdate[] };
  draftRef: { current: RigUpdate };
};
type RigConflict = { id: string; entity: string; localId: string; reason: string; localPayload: any; remotePayload: any };
type RigQueueItem = { id: string; entity: string; operation: string; changedAt: string; lastError?: string | null; payload: any };

export type FieldUpdateTwoDeviceRig = {
  UPDATE_ID: string;
  MOCK_PROJECT_ID: string;
  IPAD_NOTE: string;
  PHONE_NOTE: string;
  /** The cloud: `updates` by id, `writes` as `${device}:update:${id}`, `lostAnswers` (writes that land unanswered). */
  mockCloud: { updates: Map<string, { updatedAt: string; updateData: Record<string, any> }>; writes: string[]; lostAnswers: number };
  /** Each device's own storage, by device name and storage key. */
  mockStores: Map<string, Map<string, string>>;
  /** App.tsx's own normalisers, compiled. */
  A: Record<string, (...args: any[]) => any>;
  /** Both devices hold the phone's sent field update (note "Pour", Area 0, photo p0 taken on the phone). */
  start(): Promise<{ phone: RigDevice; ipad: RigDevice }>;
  at(when: string): void;
  on(device: RigDevice): void;
  setOnline(device: RigDevice, online: boolean): void;
  /** A card the App lets David open: its last send failed. */
  cardFails(device: RigDevice): void;
  openOnly(device: RigDevice): Promise<void>;
  saveOpened(device: RigDevice, change: (card: RigUpdate) => Partial<RigUpdate>): Promise<void>;
  openAndSave(device: RigDevice, change: (card: RigUpdate) => Partial<RigUpdate>): Promise<void>;
  backgroundUpload(device: RigDevice): Promise<void>;
  waitingUpdateSync(device: RigDevice): Promise<void>;
  refresh(device: RigDevice): Promise<boolean>;
  fullSync(device: RigDevice): Promise<unknown>;
  startup(device: RigDevice): Promise<boolean>;
  relaunchModules(device: RigDevice): void;
  chooseInSettings(device: RigDevice, conflictId: string, resolution: 'keep_local' | 'keep_cloud'): Promise<void>;
  conflictsOf(device: RigDevice): Promise<RigConflict[]>;
  queueOf(device: RigDevice): Promise<RigQueueItem[]>;
  cloudUpdate(): RigUpdate | undefined;
  theUpdate(device: RigDevice): RigUpdate | undefined;
  updatesSetter(device: RigDevice): (next: RigUpdate[] | ((previous: RigUpdate[]) => RigUpdate[])) => void;
  newPhoto(device: 'phone' | 'ipad', photoId: string, at: string): Record<string, unknown>;
  /** Build 229's queue and conflicts on this device: every record without the copy its edit started from. */
  asBuild229(device: RigDevice): void;
};

const RIG_FILE = path.resolve(__dirname, '../services/owner-answer-q28-conflicts-not-overwrite.test.ts');
const RIG_NAMES: ReadonlyArray<keyof FieldUpdateTwoDeviceRig> = [
  'UPDATE_ID', 'MOCK_PROJECT_ID', 'IPAD_NOTE', 'PHONE_NOTE', 'mockCloud', 'mockStores', 'A', 'start', 'at', 'on', 'setOnline', 'cardFails',
  'openOnly', 'saveOpened', 'openAndSave', 'backgroundUpload', 'waitingUpdateSync', 'refresh', 'fullSync', 'startup',
  'relaunchModules', 'chooseInSettings', 'conflictsOf', 'queueOf', 'cloudUpdate', 'theUpdate', 'updatesSetter', 'newPhoto',
  'asBuild229',
];

/** The rig, run in the calling test file: pass that file's own `require`, `jest` and `__dirname`. */
export function loadFieldUpdateTwoDeviceRig(scope: { require: NodeJS.Require; jest: typeof jest; dirname: string }): FieldUpdateTwoDeviceRig {
  const lines = fs.readFileSync(RIG_FILE, 'utf8').split('\n');
  const end = lines.findIndex(line => line.startsWith('describe('));
  if (end < 0) throw new Error('The Q28 test file no longer has a describe to end its rig at.');
  const js = ts.transpileModule(lines.slice(0, end).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const names = RIG_NAMES.map(name => `${name}: typeof ${name} === 'undefined' ? __missing('${name}') : ${name}`).join(', ');
  const run = new Function('require', 'jest', '__dirname', 'exports', '__missing', `${js}\nreturn { ${names} };`);
  return run(scope.require, scope.jest, scope.dirname, {}, (name: string) => {
    throw new Error(`The Q28 rig no longer has: ${name}`);
  }) as FieldUpdateTwoDeviceRig;
}
