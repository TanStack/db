/** Lazily initialize a map entry; undefined denotes an absent value. */
export function getOrCreate<K, V>(
  entries: {
    get: (key: K) => V | undefined
    set: (key: K, value: V) => unknown
  },
  key: K,
  create: () => V,
): V {
  let value = entries.get(key)
  if (value === undefined) {
    value = create()
    entries.set(key, value)
  }
  return value
}
