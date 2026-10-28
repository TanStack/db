// This grammar contains structured values only. Clone the whole scenario, not
// each write: aliases within one world stay intact, but cannot rewrite the
// other world's authority or the original replay input.
export function metadataWorlds<T>(scenario: T): { model: T; driver: T } {
  return { model: structuredClone(scenario), driver: structuredClone(scenario) }
}
