import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { ownerWhoseStorageIsInFront, subscribeToOwnerStorageSwitch } from '../services/OwnerStorageSandbox';
import { pickReportRecipient, reportRecipientPickMessage, withReportRecipient, type ReportRecipient } from '../services/ReportRecipients';

// Explicit owner keys do not move with the active workspace. A late write can
// only finish against the account and report that started it.
const PREFIX = '@vitruvius/report-recipient-selection/v1/';
const writes = new Map<string, Promise<void>>();
const storageKey = (owner: string, scope: string) => `${PREFIX}${encodeURIComponent(owner)}/${encodeURIComponent(scope)}`;
const NOT_KEPT = 'These recipients could not be kept on this device. Add them again the next time you open this report.';
function readRecipients(raw: string | null): ReportRecipient[] {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ReportRecipient => Boolean(item && typeof item === 'object' &&
      typeof item.key === 'string' && typeof item.name === 'string' &&
      (item.email === null || typeof item.email === 'string') &&
      (item.phone === null || typeof item.phone === 'string')));
  } catch { return []; }
}
type Selection = { scope: string; key: string | null; recipients: ReportRecipient[]; ready: boolean; picking: boolean; message: string };

/** Local only: each account/project set/report type/format keeps its own picks. */
export function useReportRecipients(scope: string) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const current = useRef<Selection | null>(null);
  const renderedScope = useRef(scope);
  renderedScope.current = scope;
  useEffect(() => {
    let alive = true;
    let version = 0;
    const load = () => {
      const mine = ++version;
      const next: Selection = { scope, key: null, recipients: [], ready: false, picking: false, message: '' };
      current.current = next;
      setSelection(next);
      void (async () => {
        const owner = await ownerWhoseStorageIsInFront(AsyncStorage);
        const key = owner ? storageKey(owner, scope) : null;
        if (key) await writes.get(key);
        const raw = key ? await AsyncStorage.getItem(key) : null;
        if (!alive || mine !== version || renderedScope.current !== scope) return;
        const restored = { ...next, key, recipients: readRecipients(raw), ready: true };
        current.current = restored;
        setSelection(restored);
      })().catch(() => {
        if (!alive || mine !== version || renderedScope.current !== scope) return;
        const failed = { ...next, ready: true, message: NOT_KEPT };
        current.current = failed;
        setSelection(failed);
      });
    };
    load();
    const stop = subscribeToOwnerStorageSwitch(load);
    return () => { alive = false; version++; current.current = null; stop(); };
  }, [scope]);
  const update = (mine: Selection, recipients: ReportRecipient[]) => {
    if (current.current !== mine || renderedScope.current !== mine.scope) return;
    const next = { ...mine, recipients, picking: false, message: mine.key ? '' : NOT_KEPT };
    current.current = next;
    setSelection(next);
    if (!mine.key) return;
    const key = mine.key;
    const work = (writes.get(key) ?? Promise.resolve()).catch(() => undefined)
      .then(() => AsyncStorage.setItem(key, JSON.stringify(recipients)));
    writes.set(key, work);
    void work.catch(() => {
      if (current.current === next) { const failed = { ...next, message: NOT_KEPT }; current.current = failed; setSelection(failed); }
    }).finally(() => { if (writes.get(key) === work) writes.delete(key); });
  };
  const add = () => {
    const mine = current.current;
    if (!mine?.ready || mine.picking || renderedScope.current !== mine.scope) return;
    const pending = { ...mine, picking: true, message: '' };
    current.current = pending;
    setSelection(pending);
    void pickReportRecipient().then(pick => {
      if (current.current !== pending || renderedScope.current !== pending.scope) return;
      if (pick.status === 'picked') update(pending, withReportRecipient(pending.recipients, pick.recipient));
      else { const next = { ...pending, picking: false, message: reportRecipientPickMessage(pick) }; current.current = next; setSelection(next); }
    });
  };
  const visible = selection?.scope === scope ? selection : null;
  return { recipients: visible?.recipients ?? [], picking: visible?.picking ?? false,
    loading: !visible?.ready, message: visible?.message ?? '', add,
    remove: (key: string) => { const mine = current.current; if (mine?.ready && !mine.picking) update(mine, mine.recipients.filter(item => item.key !== key)); } };
}
