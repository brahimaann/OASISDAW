import { useCallback, useRef, useSyncExternalStore } from "react";
import type * as Y from "yjs";

/**
 * Re-renders when a Yjs type (or anything inside it) changes, and returns
 * `read()`'s result. Keep `read` cheap. Do not use this for anything that
 * changes every frame (playhead): draw that on a canvas instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useY<T>(type: Y.AbstractType<any> | undefined, read: () => T, deps: readonly unknown[] = []): T {
  const version = useRef(0);
  const cache = useRef<{ v: number; value: T } | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  // `read` also depends on these (e.g. which pattern is open): re-read when they change.
  const depsRef = useRef(deps);
  if (deps.length !== depsRef.current.length || deps.some((d, i) => !Object.is(d, depsRef.current[i]))) {
    depsRef.current = deps;
    version.current++;
  }

  const subscribe = useCallback(
    (onChange: () => void) => {
      cache.current = null;
      if (!type) return () => {};
      const handler = () => {
        version.current++;
        onChange();
      };
      type.observeDeep(handler);
      return () => type.unobserveDeep(handler);
    },
    [type],
  );

  const getSnapshot = useCallback(() => {
    if (!cache.current || cache.current.v !== version.current) {
      cache.current = { v: version.current, value: readRef.current() };
    }
    return cache.current.value;
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot);
}
