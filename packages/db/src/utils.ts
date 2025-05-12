export function getLockedObjects(): Set<string> {
  // Stub implementation that returns an empty Set
  return new Set()
}

let globalVersion = 0

export function getGlobalVersion(): number {
  return globalVersion
}

export function advanceGlobalVersion(): number {
  console.log(`==== advancing global version`, globalVersion + 1)
  return globalVersion++
}
