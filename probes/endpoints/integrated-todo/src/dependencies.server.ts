// Complete server-owned footprints, including auth, functions, triggers and
// foreign-key actions. null means unknown, never an empty dependency set.
// Identities include database authority and schema; bare table names are unsafe.
export type Dependencies = ReadonlyArray<string> | null

export function intersects(
  reads: Dependencies,
  writes: ReadonlySet<string> | null,
): boolean {
  if (reads === null || writes === null) return true
  return reads.some((relation) => writes.has(relation))
}
