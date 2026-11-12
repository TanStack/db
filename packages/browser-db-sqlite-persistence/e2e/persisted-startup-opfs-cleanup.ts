// Fixture-owned files only. Close their worker before deleting SQLite sidecars.
// The Playwright context gives this page an isolated origin.
export async function removeStartupOPFSArtifacts(databaseName: string) {
  const root = await navigator.storage.getDirectory()
  for (const suffix of [``, `-journal`, `-wal`, `-shm`]) {
    try {
      await root.removeEntry(`${databaseName}${suffix}`)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === `NotFoundError`))
        throw error
    }
  }
  const iterable = root as FileSystemDirectoryHandle & {
    entries: () => AsyncIterableIterator<[string, FileSystemHandle]>
  }
  for await (const [name, handle] of iterable.entries()) {
    if (handle.kind === `directory` && name.startsWith(`.ahp-`))
      await root.removeEntry(name, { recursive: true })
  }
}
export async function startupOPFSArtifacts(): Promise<Array<string>> {
  const root =
    (await navigator.storage.getDirectory()) as FileSystemDirectoryHandle & {
      keys: () => AsyncIterableIterator<string>
    }
  const artifacts: Array<string> = []
  for await (const name of root.keys())
    if (name.startsWith(`ps-`) || name.startsWith(`.ahp-`)) artifacts.push(name)
  return artifacts.sort()
}
