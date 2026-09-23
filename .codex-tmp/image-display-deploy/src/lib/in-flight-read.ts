/** Share overlapping reads only; completed values and failures are never cached. */
export function coalesceInFlightRead<Key, Value>(read: (key: Key) => Promise<Value>) {
  const pending = new Map<Key, Promise<Value>>();
  return (key: Key): Promise<Value> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const result = Promise.resolve().then(() => read(key)).finally(() => {
      pending.delete(key);
    });
    pending.set(key, result);
    return result;
  };
}
