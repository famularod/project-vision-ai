import { useEffect, useRef, useState } from 'react';

export type DebouncedSnapshot<T> = {
  value: T;
  signature: string;
  priorityKey: string;
};

export function useDebouncedSnapshot<T>({
  value,
  signature,
  priorityKey,
  delayMs,
}: {
  value: T;
  signature: string;
  priorityKey: string;
  delayMs: number;
}) {
  const latestValueRef = useRef(value);
  latestValueRef.current = value;
  const [snapshot, setSnapshot] = useState<DebouncedSnapshot<T>>(() => ({
    value,
    signature,
    priorityKey,
  }));

  useEffect(() => {
    if (signature === snapshot.signature) return;

    const commit = () => setSnapshot({
      value: latestValueRef.current,
      signature,
      priorityKey,
    });

    if (priorityKey !== snapshot.priorityKey) {
      commit();
      return;
    }

    const timer = setTimeout(commit, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, priorityKey, signature, snapshot.priorityKey, snapshot.signature]);

  return snapshot;
}
