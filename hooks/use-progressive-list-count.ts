import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

export function useProgressiveListCount(
  itemCount: number,
  identity: string,
  chunkSize = 4,
) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(chunkSize, itemCount));

  useEffect(() => {
    setVisibleCount(Math.min(chunkSize, itemCount));
    if (itemCount <= chunkSize) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const interaction = InteractionManager.runAfterInteractions(() => {
      const revealNextChunk = () => {
        if (!active) return;
        setVisibleCount(current => {
          const next = Math.min(current + chunkSize, itemCount);
          if (next < itemCount) timer = setTimeout(revealNextChunk, 16);
          return next;
        });
      };
      revealNextChunk();
    });
    return () => {
      active = false;
      interaction.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [chunkSize, identity, itemCount]);

  return visibleCount;
}
